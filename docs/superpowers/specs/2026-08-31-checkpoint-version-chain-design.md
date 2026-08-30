# Checkpoint 多版本链设计规范

> 状态：待审核 | 日期：2026-08-31 | 版本：1.0

---

## 一、背景与动机

当前 Vico 的 checkpoint 机制（`packages/core/src/agent/checkpoint.ts`）是 **turn 级单行、原地覆盖**：每个 turn 一条记录，`update()` 全量覆盖最新快照，turn 完成时 `deleteByTurn` 删除。这带来三个问题：

1. **无审计/可观测**：崩溃现场被覆盖，无法回答"这个 turn 执行过程中发生了什么"。
2. **无回放能力**：无法从历史状态恢复执行。
3. **mutation 工具"恰好一次"未闭环**（见第四节）——`pendingToolCall` 单字段无法区分"执行前崩溃"与"执行后结果未提交崩溃"，恢复路径 `resolvePendingTool` 无条件重执行，导致有副作用工具可能执行两次。

本文档将 checkpoint 升级为**多版本链**，同时修复恰好一次问题。

## 二、设计目标

1. **审计**：保留每个 step 的 checkpoint 快照历史，事故可溯源、可 inspect。
2. **回放**：支持从任意历史版本**分叉成新 turn** 继续执行（fork 语义），原 turn 版本链不变。
3. **修复正确性**：mutation 工具崩溃/并发下不重复执行（尽力而为 + 工具契约）。
4. 与现有 `ThreadStore` 分工不变——checkpoint 管恢复现场，threadStore 管消息持久化。

## 三、决策记录（已与需求方确认）

| 维度 | 决策 |
|------|------|
| 升级目标 | 审计 + 可回放（fork）+ 顺带修复恰好一次 |
| 版本粒度 | 每 step 一个版本 |
| 保留策略 | 全保留 + 全局 TTL |
| 回放语义 | 分叉成新 turn，原 turn 版本链不变 |
| 存储模型 | 全量快照版本链 |

## 四、数据模型（双表设计）

崩溃恢复需要 `pendingToolCall` **实时**落盘（tool-pre/tool-done 即时写），而审计粒度是 step 级——两者粒度冲突。因此采用**双表**：

**表 A：`vico_checkpoints`（现有单行 = 最新现场行，保留不变）**
- 承担崩溃/审批恢复的实时性
- 现有 5 个 `update` 调用点（step-start / tool-pre / tool-done / pause）继续即时写它

**表 B：`vico_checkpoint_versions`（新增 = 审计/回放版本链）**

```sql
CREATE TABLE vico_checkpoint_versions (
  turn_id     TEXT NOT NULL,
  thread_id   TEXT NOT NULL,
  version     INTEGER NOT NULL,          -- per-turn 单调递增
  step_index  INTEGER NOT NULL,
  paused      INTEGER NOT NULL DEFAULT 0, -- 冗余列：支持按暂停态查询
  next_action TEXT NOT NULL,             -- 下一步意图，见 CheckpointVersion.nextAction
  snapshot    TEXT NOT NULL,             -- 完整 Checkpoint JSON（现有类型）
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (turn_id, version)         -- 复合主键天然构成版本链
);
CREATE INDEX idx_ckpt_versions_thread ON vico_checkpoint_versions(thread_id);
```

**类型新增**（checkpoint.ts）：

```typescript
type NextAction = 'model' | 'tool-approval' | 'end';

interface CheckpointVersion {
  turnId: string;
  threadId: string;
  version: number;      // per-turn 递增
  stepIndex: number;
  /** 下一步意图：模型调用 / 等待审批 / 待执行工具 / 已结束 */
  nextAction: NextAction;
  snapshot: Checkpoint; // 复用现有 Checkpoint 快照类型
  createdAt: number;
}
```

**版本链的构成**：版本不需要显式前驱指针——`(turn_id, version)` 复合主键天然有序，同一 turn 的版本前驱即 `version - 1`，审计沿 `listVersions(turnId)` 升序遍历即得完整链，无冗余字段。

**fork 来源（turn 级元数据）**：新 turn 从哪里分叉而来，是 turn 生命周期的一次性信息，不随每个版本重复。记录在新 turn 上：

```typescript
// Turn 类型新增（thread-store.ts）
forkedFrom: { turnId: string; version: number } | null;  // 本 turn 由源 turn 的某版本分叉而来
```

**为什么加 `nextAction`**：版本快照只有"当前状态"，审计时看不出版本之后要发生什么。`nextAction` 显式标注下一步，三态与 append 时机严格对应：

| nextAction | append 时机 | 快照特征 |
|-----------|------------|---------|
| `model` | step 完成 | `pendingToolCall`=null、`pauseInfo`=null、尚未结束，下一步进入下一轮模型调用 |
| `tool-approval` | pause | `pauseInfo` 非空、`pendingToolCall`=null，下一步等待审批 |
| `end` | completed / failed / aborted | 终态 |

**为什么没有 `tool-execution`**：有待执行工具（`pendingToolCall` 非空）是 step **内部**的瞬间状态（tool-pre → tool-done 之间），实时性由现场行（表 A）承担，不进入 step 级版本链——版本 append 的三个时机（step 完成 / pause / 终态）恰好都在 `pendingToolCall` 已清空或未设置之后，故版本快照中 `pendingToolCall` 恒为 null，`tool-execution` 永远不会被 append 使用。

**Checkpoint 类型修正**：新增一个字段，供分叉时精确定位消息链边界。

```typescript
interface Checkpoint {
  // ...现有字段
  lastMessageId: string | null;  // appendVersion 时记录当时的最后一条消息 id
}
```

旧快照 JSON parse 后缺该字段，用 `?? null` 兜底；`CHECKPOINT_CURRENT_VERSION` 保持 1，无需迁移函数。

**分工**：
- 崩溃恢复 → 读表 A（实时现场行）
- 审计/回放/fork → 读表 B（版本链）
- 版本链 append 时机：每个 step 完成、pause、completed 终态（替代现有 `deleteByTurn`）

## 五、CheckpointStore 接口改造

现有 6 个方法保留 5 个（语义微调），新增 4 个。三个 store（内存/LibSQL/MySQL）同步实现。

| 方法 | 变化 | 说明 |
|------|------|------|
| `create(turnId, threadId)` | 保留 | 写现场行 + 初始化版本链（version 1） |
| `update(checkpoint)` | 保留 | 继续写现场行，实时崩溃恢复。现有调用点不动 |
| `getByTurn(turnId)` | 保留 | 读现场行（最新），resumeTurn/start 检测逻辑不变 |
| `deleteByTurn(turnId)` | 改造 | 不再于 completed 时调用；改为显式删除整个 turn 的版本链 |
| `purgeExpired(ttlMs)` | 改造 | 按 created_at 整链删除（一个 turn 的所有版本一起删）+ 级联删现场行 |
| `listByThread(threadId)` | 保留 | 读现场行（每 turn 最新），审计明细走新方法 |
| **`appendVersion(checkpoint, { nextAction })`** | 新增 | step 完成 / pause / completed / failed / aborted 时，把现场行快照 append 到版本链，版本号 = max+1；`nextAction` 由调用点传入（step→model / pause→tool-approval / 终态→end） |
| **`getVersion(turnId, version)`** | 新增 | 读指定版本，审计 / fork 用 |
| **`listVersions(turnId)`** | 新增 | 按版本号升序返回，审计时间线 |
| **`fork(turnId, version, newTurnId, newThreadId)`** | 新增 | 从历史版本复制快照到新 turn 的现场行，作为分叉起点 |

**loop-agent.ts 调用点改造**：
- step 完成：追加 `appendVersion`，nextAction=`model`（每 step 一个版本）
- pause 状态：追加 `appendVersion`，nextAction=`tool-approval`（pause 现场进版本链）
- completed 终态：`deleteByTurn`（loop-agent.ts:445）→ `appendVersion`，nextAction=`end`（写终态版本）
- failed / aborted 终态：追加 `appendVersion`，nextAction=`end`（失败/中断现场也进版本链，审计可见）
- `update` 的 5 个现有调用点：**零改动**（继续实时写现场行）

## 六、fork 回放流程（分叉成新 turn）

```
1. getVersion(turnId, version)          → 读版本链快照（含 stepIndex + lastMessageId + nextAction）
2. threadStore 复制消息链：
     getEntriesByTurns([turnId]) → 找到 lastMessageId → 截断之后
     → 复制到新 thread（新 turn 获得独立消息链）
3. threadStore.createTurn(新thread)     → 新 turn，status: running，forkedFrom = { 源turn, 分叉版本 }
4. checkpointStore.fork(...)            → 从快照复制初始化新 turn 现场行（stepIndex 取分叉点）
5. 返回新 turn —— 用户发新消息 → chat API → start() 检测到
   未完成 turn + checkpoint → resumeTurn → startTurnLoop(分叉点 stepIndex)
   → 从分叉点带新指令继续执行，原 turn 版本链保持不变
```

**fork 来源追溯**：分叉出的新 turn 通过 turn 级 `forkedFrom` 指向 `{ 源turn, 分叉版本 }`——审计时从新 turn 一跳定位源版本，能看到"这个 turn 是哪个 turn 从哪一步分叉出来的"。

**为什么能复用 resumeTurn**：分叉出的新 turn 是 `running` + 有现场行 + 有消息链，正好命中 `start()` 的恢复检测（loop-agent.ts:243-251）。`resumeTurn` 里 `pauseInfo`/`pendingToolCall` 通常为 null → 走路径 C 直接续跑，并把用户的新消息 push 进上下文。

**原 turn 的完整性**：分叉只读版本链快照 + 复制消息，不写原 turn 任何字段——审计历史零污染。

**边界**：
- 旧 turn（升级前无版本链）：`fork` 返回"该 turn 无历史版本，不可分叉"错误，可降级为从现场行复制（等价现状）
- 分叉后继续执行产生的步骤，正常 append 到**新 turn** 自己的版本链

## 七、幂等修复（mutation 工具恰好一次）

**判据原则**：恢复时以**消息链是否有该 toolCallId 的 tool_result** 为事实判据，不再以"pendingToolCall 是否清除"为准。

**三层防线**：

| 防线 | 封堵的缺口 | 实现 |
|------|-----------|------|
| ① per-turn 执行锁 | 并发恢复 TOCTOU（两个请求都执行 pending 工具） | 内存 `Map<turnId, Promise>`，同一 turn 的 `resumeTurn` 串行排队。Vico 是单进程 + libsql 本地文件，内存锁足够 |
| ② 消息链检查 | 工具已执行且结果已落消息链（appendToolResults 之后） | `resolvePendingTool`（loop-agent.ts:398）执行前查消息链，已有该 callId 的 tool_result → 跳过执行、直接采纳链上结果 |
| ③ completedToolResults 检查 | 工具已执行、结果已入内存数组、但 pendingToolCall 未清（tool-executor.ts:124→126 窗口） | 恢复时若 pending 工具的 id 已在 `completedToolResults` 里 → 说明执行已完成，直接用缓存结果，不重跑 |

同时修复现有 bug：`resolvePendingTool`（loop-agent.ts:401）不再无条件 `appendToolResults([...completedToolResults, ...pendingToolResults])`，改为逐条去重——只在消息链缺失时才注入。

**诚实边界**：绝对"恰好一次"在 checkpoint 层**不可达**。工具副作用和执行返回值序列化之间非原子，存在不可消除的极小窗口（`execute()` 已返回、副作用已发生，但结果还没写进任何持久化，如 tool-executor.ts:123→124 之间崩溃），此时恢复只能重执行。三层防线把"恰好一次"推进到"只剩这一个窗口"，剩下的需要**工具契约**配合：mutation 工具应声明自身幂等（`Tool` 增加 `idempotent?: boolean` 或文档约束），或业务接受"重试语义"。

## 八、保留策略与清理

- turn 完成后版本链不删，全量保留
- `purgeExpired(ttlMs)` **本次接线**（现有实现从未被调用）：服务启动时调一次 + `setInterval` 每小时一次（在 `vico/server/src/vico.ts` 初始化处挂）
- 整链删除：一个 turn 的所有版本一起删（否则断链），级联删现场行
- TTL 默认 30 天，走 `server.config.yaml` 可配

## 九、迁移与兼容

- 现有 `vico_checkpoints` 单行现场行**零改动**，现有数据直接继续用
- 新增 `vico_checkpoint_versions` 表，由 `ensureTables`（libsql-adapter/src/migrate.ts:66）建表
- 旧 turn（升级前）：现场行在、版本链空 → 审计显示"无历史版本"，fork 降级为从现场行复制
- `lastMessageId` 用 `?? null` 兜底，无需版本迁移

## 十、测试

- **store 单测**：appendVersion 版本递增、getVersion、listVersions 排序、fork 快照复制、purgeExpired 整链删除、`nextAction` 标注正确性、listVersions 顺序即版本链导航、fork 来源追溯（turn 级 `forkedFrom` 回源）
- **loop 集成**：崩溃恢复三条路径 + fork 后续跑 + 幂等三层防线（窗口 B 模拟、并发恢复串行、completedToolResults 去重）
- **purgeExpired 接线验证**（启动调用）

## 十一、改动文件清单

```
packages/core/src/agent/checkpoint.ts               类型+接口（CheckpointVersion 含 nextAction；Checkpoint 含 lastMessageId）
packages/core/src/thread/thread-store.ts            Turn 类型增加 forkedFrom
packages/core/src/agent/memory-checkpoint-store.ts  新方法（appendVersion/getVersion/listVersions/fork）
packages/libsql-adapter/src/schema.ts               版本链表定义
packages/libsql-adapter/src/migrate.ts              ensureTables 建表
packages/libsql-adapter/src/libsql-checkpoint-store.ts 新方法
packages/mysql-adapter/src/mysql-checkpoint-store.ts   新方法
packages/core/src/agent/loop-agent.ts               appendVersion 调用点 + resolvePendingTool 修复 + per-turn 锁
vico/server/src/vico.ts                             purgeExpired 接线
```

## 十二、风险与边界

| 风险 | 影响 | 缓解 |
|------|------|------|
| 版本链存储膨胀 | 全量快照每 step 一份，长 turn 累积 | TTL 兜底（默认 30 天）；版本链与现场行分离，现场行始终单行 |
| 绝对恰好一次不可达 | mutation 工具极端窗口下仍可能双执行 | 三层防线 + 工具幂等契约；文档明确边界 |
| fork 后消息链与现场不一致 | 分叉点截断错误导致上下文错乱 | 依赖 `lastMessageId` 精确定位；测试覆盖 |
| 旧 turn 无版本链 | fork 不可用 | 降级为从现场行复制（等价现状） |
| `purgeExpired` 误删活跃 turn | 长执行 turn 的版本被 TTL 清除 | TTL 30 天远大于单 turn 执行时长；purge 只删 `created_at < cutoff` 的完整链 |
