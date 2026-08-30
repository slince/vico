# Checkpoint 多版本制设计规范

> 状态：待审核 | 日期：2026-08-31 | 版本：2.0

---

## 一、背景与动机

当前 Vico 的 checkpoint 机制（`packages/core/src/agent/checkpoint.ts`）是 **turn 级单行、原地覆盖**：每个 turn 一条记录，`update()` 全量覆盖最新快照，turn 完成时 `deleteByTurn` 删除。这带来三个问题：

1. **无审计/可观测**：崩溃现场被覆盖，无法回答"这个 turn 执行过程中发生了什么"。
2. **无回放能力**：无法从历史状态恢复执行。
3. **mutation 工具"恰好一次"未闭环**——`pendingToolCall` 单字段无法区分"执行前崩溃"与"执行后结果未提交崩溃"，恢复路径 `resolvePendingTool`（loop-agent.ts:398）无条件重执行，导致有副作用工具可能执行两次。

本文档将 checkpoint 升级为**多版本制**：一个 turn 保存多个按版本号递增的快照，同时修复恰好一次问题。

## 二、设计目标

1. **审计**：保留每个 step 的 checkpoint 快照历史，事故可溯源、可 inspect。
2. **回放**：支持从任意历史版本**分叉成新 turn** 继续执行（fork 语义），原 turn 版本链不变。
3. **修复正确性**：mutation 工具崩溃/并发下不重复执行（消息链核对 + 工具契约）。
4. 与现有 `ThreadStore` 分工不变——checkpoint 管执行进度快照，threadStore 管消息持久化（消息链是恢复的"事实源"）。

## 三、决策记录（已与需求方确认）

| 维度 | 决策 |
|------|------|
| 升级目标 | 审计 + 可回放（fork）+ 顺带修复恰好一次 |
| 版本粒度 | 每 step 一个版本 |
| 保留策略 | 全保留 + 全局 TTL |
| 回放语义 | 分叉成新 turn，原 turn 版本链不变 |
| 存储模型 | 单表全量快照（`vico_checkpoints` 直接改造为多版本制，不新增表） |
| 实时恢复粒度 | 不保留 tool 级现场行；崩溃恢复 = 从最新版本重跑未完成 step |

**关键取舍**：单表、无 tool 级实时现场行。崩溃恢复退化为"step 级重跑"，mutation 工具不重复执行依赖**消息链核对（已配对结果不重发）+ 工具幂等契约**。这一取舍消除了现场行与版本链同步的复杂度（此前双表方案中，现场行的 tool 级实时写入也并未实现完全"恰好一次"——`execute()` 返回后、`tool-done` 写入前的窗口仍然会双执行，见 `tool-executor.ts:123→126`）。

## 四、数据模型

**`vico_checkpoints`（现有表，改造为多版本制）**——复合主键 `(turn_id, version)`，一个 turn 多行，每行一个版本快照。

```sql
CREATE TABLE vico_checkpoints (
  turn_id     TEXT NOT NULL,
  thread_id   TEXT NOT NULL,
  version     INTEGER NOT NULL,          -- per-turn 递增链版本号
  step_index  INTEGER NOT NULL,          -- 恢复续跑点（冗余列，便于按 step 查询）
  next_action TEXT NOT NULL,             -- 下一步意图：model | tool-approval | end
  snapshot    TEXT NOT NULL,             -- 完整 Checkpoint JSON（含 approvedTools/pauseInfo/lastMessageId/schemaVersion）
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (turn_id, version)         -- 复合主键天然构成版本链
);
CREATE INDEX idx_checkpoints_thread_id ON vico_checkpoints(thread_id);
```

**类型定义**（checkpoint.ts 重写）：

```typescript
type NextAction = 'model' | 'tool-approval' | 'end';

/** vico_checkpoints 一行 = 一个版本 */
interface Checkpoint {
  turnId: string;
  threadId: string;
  /** per-turn 递增链版本号（非 schema 版本） */
  version: number;
  /** 恢复续跑点：下一步从该 step 继续（平铺列 step_index） */
  stepIndex: number;
  /** 下一步意图：模型调用 / 等待审批 / 已结束（平铺列 next_action） */
  nextAction: NextAction;
  // ── 以下序列化进 snapshot JSON ──
  /** 本 turn 已批准的工具名 → ToolApproval */
  approvedTools: Record<string, ToolApproval>;
  /** 暂停现场（非空 = 等待审批/出错） */
  pauseInfo: PauseInfo | null;
  /** append 时的最后一条消息 id，fork 时截断消息链用 */
  lastMessageId: string | null;
  /** checkpoint schema 版本，懒迁移用 */
  schemaVersion: number;
  createdAt: number;
}
```

**版本链的构成**：版本不需要显式前驱指针——`(turn_id, version)` 复合主键天然有序，同一 turn 的版本前驱即 `version - 1`，审计沿 `listVersions(turnId)` 升序遍历即得完整链，无冗余字段。

**fork 来源（turn 级元数据）**：新 turn 从哪里分叉而来，是 turn 生命周期的一次性信息，不随每个版本重复。记录在新 turn 上：

```typescript
// Turn 类型新增（thread-store.ts）
forkedFrom: { turnId: string; version: number } | null;  // 本 turn 由源 turn 的某版本分叉而来
```

**`nextAction` 三态与 append 时机严格对应**：

| nextAction | append 时机 | 快照特征 |
|-----------|------------|---------|
| `model` | step 完成 | `pauseInfo`=null，下一步进入下一轮模型调用 |
| `tool-approval` | pause | `pauseInfo` 非空，下一步等待审批 |
| `end` | completed / failed / aborted | 终态 |

**为什么没有 tool 级中间状态**：待执行/执行中的工具是 step 内部瞬间态，无实时落盘。快照只在 step 完成 / pause / 终态生成，不追踪工具执行细节——工具是否完成由消息链（事实源）判定。

## 五、CheckpointStore 接口改造

现有 6 个方法改造为版本链语义，删除 `update` 与 `listByThread`。三个 store（内存/LibSQL/MySQL）同步实现。

| 方法 | 变化 | 说明 |
|------|------|------|
| `create(turnId, threadId)` | 改造 | append 初始版本（version=1、stepIndex=0、nextAction=model） |
| ~~`update(checkpoint)`~~ | **删除** | 版本链 append-only，无原地更新 |
| `getByTurn(turnId)` → **`getLatest(turnId)`** | 改造 | 读最新版本（版本号最大），崩溃/审批恢复用 |
| **`append(patch)`** | 新增 | 追加一个版本，版本号 = max+1；`nextAction` 由调用点传入 |
| **`getVersion(turnId, version)`** | 新增 | 读指定版本，审计 / fork 用 |
| **`listVersions(turnId)`** | 新增 | 按版本号升序返回，审计时间线 |
| **`fork(sourceTurnId, version, newTurnId, newThreadId)`** | 新增 | 从历史版本复制快照到新 turn 的初始版本，作为分叉起点 |
| `deleteByTurn(turnId)` | 保留 | 删除整个 turn 的版本链（显式清理，非自动） |
| `purgeExpired(ttlMs)` | 改造 | 按 created_at 整链删除（一个 turn 的所有版本一起删，避免断链） |
| `listByThread(threadId)` | 删除 | 审计走 `listVersions(turnId)`，按 turn 粒度查询 |

**loop-agent.ts 调用点改造**：
- turn 开始：`create(turnId, threadId)`（初始版本）
- step 完成：`append`，nextAction=`model`（每 step 一个版本）
- pause 状态：`append`，nextAction=`tool-approval`（暂停现场进版本链）
- completed / failed / aborted 终态：`append`，nextAction=`end`（终态进版本链，审计可见）
- **所有 `checkpointStore.update` 调用点删除**（step-start / tool-pre / tool-done / pause 的实时写全部移除）

**tool-executor.ts**：删除全部 checkpoint 写入逻辑（tool-pre / tool-done 的 `store.update`），工具结果只落消息链。

## 六、fork 回放流程（分叉成新 turn）

```
1. getVersion(turnId, version)          → 读指定版本快照（含 stepIndex + lastMessageId + nextAction）
2. threadStore 复制消息链：
     getEntriesByTurns([turnId]) → 找到 lastMessageId → 截断之后
     → 复制到新 thread（新 turn 获得独立消息链）
3. threadStore.createTurn(新thread)     → 新 turn，status: running，forkedFrom = { 源turn, 分叉版本 }
4. checkpointStore.fork(...)            → 从快照复制初始化新 turn 的初始版本（stepIndex 取分叉点，
                                          nextAction/pauseInfo 继承源版本，恢复逻辑沿用 resumeTurn）
5. 返回新 turn —— 用户发新消息 → chat API → start() 检测到
   未完成 turn + 有 checkpoint → resumeTurn → startTurnLoop(分叉点 stepIndex)
   → 从分叉点带新指令继续执行，原 turn 版本链保持不变
```

**为什么能复用 resumeTurn**：分叉出的新 turn 是 `running` + 有 checkpoint + 有消息链，正好命中 `start()` 的恢复检测（loop-agent.ts:243-251）。

**fork 来源追溯**：通过 turn 级 `forkedFrom` 指向 `{ 源turn, 分叉版本 }`——审计时从新 turn 一跳定位源版本。

**原 turn 的完整性**：分叉只读版本快照 + 复制消息，不写原 turn 任何字段——审计历史零污染。

**边界**：
- 旧 turn（升级前无版本链）：`fork` 返回"该 turn 无历史版本，不可分叉"
- 分叉后继续执行产生的步骤，正常 append 到**新 turn** 自己的版本链

## 七、幂等修复（mutation 工具恰好一次）

**判据原则**：消息链是唯一"事实源"——工具是否已执行以消息链中是否存在对应的 `tool_result` 为准。checkpoint 只记录执行进度，不记录工具级现场。

**恢复路径（`resumeTurn`）简化为两条**：
- `pauseInfo` 非空 → 审批恢复（`applyPauseInfoRecovery`，处理待审批调用）
- 否则 → 消息链核对后从 `stepIndex` 续跑（见防线②）
原路径 B（`pendingToolCall` 重试）随 `pendingToolCall` 字段一并删除。

**防线**：

| 防线 | 封堵的缺口 | 实现 |
|------|-----------|------|
| ① per-turn 执行锁 | 并发恢复 TOCTOU（两个请求同时恢复同一 turn） | 内存 `Map<turnId, Promise>`，同一 turn 的 `resumeTurn` 串行排队。Vico 是单进程 + libsql 本地文件，内存锁足够 |
| ② 消息链核对 | 崩溃恢复重跑 step 时，已完成的工具被重复执行 | 恢复时检查最后一条 assistant 的 toolCalls 是否全部配对 `tool_result`：全部配对 → step 已完成，直接从 stepIndex 下一步继续（不再 callModel 重发）；有未配对 → 重新 callModel，模型基于现有链重新决策 |

**诚实边界**：绝对"恰好一次"在 checkpoint 层**不可达**。崩溃发生在 step 内部"副作用已发生但结果未落消息链"的窗口（`execute()` 返回后、`appendToolResults` 前）时，恢复重跑该 step 会重新执行 mutation 工具。**这个窗口只能靠工具幂等契约闭合**：mutation 工具应声明自身幂等（`Tool` 增加 `idempotent?: boolean` 或文档约束），或业务接受"重试语义"。checkpoint 层保证的是——**已落消息链的工具结果绝不重发**。

## 八、保留策略与清理

- turn 完成后版本链不删，全量保留
- `purgeExpired(ttlMs)` **本次接线**（现有实现从未被调用）：服务启动时调一次 + `setInterval` 每小时一次（在 `vico/server/src/vico.ts` 初始化处挂）
- 整链删除：一个 turn 的所有版本一起删（否则断链）
- TTL 默认 30 天，走 `server.config.yaml` 可配

## 九、迁移与兼容

- `vico_checkpoints` 表结构变更：单行（`turn_id` UNIQUE + 单列主键 `id`）→ 多版本（复合主键 `(turn_id, version)`），删 `id`/`paused`/`pending_tool`/`updated_at` 列，加 `next_action` 列
- 由 `ensureTables`（libsql-adapter/src/migrate.ts:66）在启动时检测旧结构（`turn_id` UNIQUE 单列主键 `id`）并重建表——SQLite 下复合主键变更无法 ALTER，需 DROP + CREATE 重建，`CREATE TABLE IF NOT EXISTS` 无法处理已存在的旧表
- 旧单行数据（升级前运行中 turn 的现场）：不迁移，启动时丢弃——运行中的 turn 降级为"无 checkpoint"，下次请求走新建 turn（开发期项目，务实取舍）
- 快照内 `schemaVersion` 保留懒迁移机制（`CHECKPOINT_CURRENT_VERSION` / `checkpointMigrations` 读时升级）；`lastMessageId` 用 `?? null` 兜底

## 十、测试

- **store 单测**：create 初始版本、append 版本递增、getLatest 取最新、getVersion、listVersions 升序、fork 快照复制、purgeExpired 整链删除、`nextAction` 标注正确性
- **loop 集成**：崩溃恢复（step 级重跑 + 消息链核对：已配对不重发、未配对重跑）、pause 恢复、fork 后续跑、并发恢复串行（per-turn 锁）
- **purgeExpired 接线验证**（启动调用）

## 十一、改动文件清单

```
packages/core/src/agent/checkpoint.ts               Checkpoint 多版本类型 + CheckpointStore 接口重写
packages/core/src/thread/thread-store.ts            Turn 类型增加 forkedFrom
packages/core/src/agent/memory-checkpoint-store.ts  create/append/getLatest/getVersion/listVersions/fork/deleteByTurn/purgeExpired
packages/libsql-adapter/src/schema.ts               vico_checkpoints 复合主键 + next_action
packages/libsql-adapter/src/migrate.ts              ensureTables 改表
packages/libsql-adapter/src/libsql-checkpoint-store.ts 重写
packages/mysql-adapter/src/mysql-checkpoint-store.ts    重写
packages/core/src/agent/loop-agent.ts               create/append 调用点 + 恢复逻辑（消息链核对）+ per-turn 锁
packages/core/src/agent/tool-executor.ts            删除 checkpoint 写入
vico/server/src/vico.ts                             purgeExpired 接线
```

## 十二、风险与边界

| 风险 | 影响 | 缓解 |
|------|------|------|
| 版本链存储膨胀 | 全量快照每 step 一份，长 turn 累积 | TTL 兜底（默认 30 天） |
| 绝对恰好一次不可达 | 极端窗口下 mutation 工具可能重执行 | 消息链核对（已落链不重发）+ 工具幂等契约；文档明确边界 |
| 崩溃重跑 step 浪费 token | 重跑含未配对 toolCalls 的 step | 消息链核对减少重发；LLM 无状态，重跑语义正确 |
| fork 后消息链与快照不一致 | 分叉点截断错误导致上下文错乱 | 依赖 `lastMessageId` 精确定位；测试覆盖 |
| 旧 turn 无版本链 | fork 不可用 | 返回"无历史版本，不可分叉" |
| `purgeExpired` 误删活跃 turn | 长执行 turn 的版本被 TTL 清除 | TTL 30 天远大于单 turn 执行时长；purge 只删 `created_at < cutoff` 的完整链 |
