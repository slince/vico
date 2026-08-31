# Checkpoint 版本树 + pauseInfo 平铺 设计

> 设计日期：2026-09-01
> 关联：上一轮多版本链见 [2026-08-31-checkpoint-version-chain-design.md](./2026-08-31-checkpoint-version-chain-design.md)

## 背景与目标

上一轮把 checkpoint 存储升级为「(turn_id, version) 复合主键多版本链 append-only」，血缘靠 version 连续递增隐含（`version-1` 即上一版）。本轮升级两点：

1. **加入上一版本 id 字段（不得移除）**——显式版本树。分叉点包含 turn 内部（同一父版本可有多个子版本），不再只限 fork 跨 turn。
2. **pauseInfo 嵌套字段平铺到 Checkpoint 顶层**——`pendingToolCalls` 更名表达「待审批的 ToolCall」；resume 逻辑简化：读目标 checkpoint 直接还原，不做嵌套解包与兼容处理。

非目标：崩溃恢复不引入逐调用执行状态追踪（见「崩溃恢复语义」），消息链配对 + 截断重决策是既定语义。

## 核心决策

| 项 | 决策 |
|---|---|
| parentId 形态 | 全局 uuid `id` 列 + `parentId`(uuid)；主键从 `(turn_id, version)` 变为 `id` 单列 + `UNIQUE(turn_id, version)` |
| version 语义 | turn 内单调递增（每次 append max+1），仅作顺序/审计标签；血缘由 parentId 表达；恢复显式指定目标叶版本 |
| pauseInfo 平铺 | `pendingApprovalCalls`/`approvedCalls`/`deniedResults` 恒为数组上移顶层；删 `reason`（并入 `nextAction`）与 `pausedAtStep`（与 `stepIndex` 恒等） |
| resume | 双路径并单路径；防线② gate 从 `!checkpoint.pauseInfo` 改为 `checkpoint.nextAction !== 'tool-approval'` |
| 迁移 | DROP 重建；`CHECKPOINT_CURRENT_VERSION = 2`；libsql + mysql 适配器同步 |
| 崩溃恢复 | 维持消息链配对 + 截断重决策；副作用重跑风险由工具幂等兜底 |

## 数据模型

`packages/core/src/agent/checkpoint.ts`

```typescript
/** checkpoint 快照（snapshot JSON）schema 当前版本 */
export const CHECKPOINT_CURRENT_VERSION = 2;

/** 下一步意图：模型调用 / 等待审批 / 已结束（原 PauseInfo.reason 并入） */
export type NextAction = 'model' | 'tool-approval' | 'end';

/**
 * vico_checkpoints 一行 = 一个版本（完整快照）。
 * id 为全局唯一版本节点 id；parentId 指向上一版本（可跨 turn，fork 时指向源版本）。
 * version 为 turn 内单调递增序号（append max+1），仅作顺序/审计标签。
 */
export interface Checkpoint {
  id: string;                        // 全局唯一 uuid（版本节点 id）
  parentId: string | null;           // 上一版本 id；null = 根版本（create 或 fork 根）
  turnId: string;
  threadId: string;
  version: number;                   // turn 内单调递增（每次 append max+1）
  stepIndex: number;                 // 恢复续跑点
  nextAction: NextAction;            // 唯一状态判别（原 reason 并入；'tool-approval' = 有审批现场）
  approvedTools: Record<string, ToolApproval>;
  // —— 原 PauseInfo 平铺（恒为数组，不再嵌套判空）——
  pendingApprovalCalls: ToolCall[];  // 待审批的 ToolCall（原 pendingToolCalls）
  approvedCalls: ToolCall[];         // 审批阶段已自动批准的调用，恢复时直接执行
  deniedResults: ToolResult[];       // 已自动拒绝的结果，恢复时直接落库
  lastMessageId: string | null;      // append 时最后一条消息 id，fork 截断消息链用
  schemaVersion: number;
  createdAt: number;
}

/**
 * append 追加一个版本的增量 patch。全部必填 —— 合并语义为「patch 字段全量覆盖最新版本快照」。
 * parentId 显式传入（= 当前 context.checkpoint.id），支持从非最新叶续跑时正确挂接父版本。
 */
export interface CheckpointAppendPatch {
  parentId: string | null;
  stepIndex: number;
  nextAction: NextAction;
  approvedTools: Record<string, ToolApproval>;
  pendingApprovalCalls: ToolCall[];
  approvedCalls: ToolCall[];
  deniedResults: ToolResult[];
  lastMessageId: string | null;
}
```

### 删除项

- `PauseInfo` 接口整体删除。
- `PauseInfo.reason`：实际只构造 `'tool-approval'`（`'error'` 是死路径，`executeModelStep` 从不构造），状态判别交由 `nextAction`。
- `PauseInfo.pausedAtStep`：append 时恒等于顶层 `stepIndex`（都是循环内 `steps`），冗余删除。

### 版本迁移

- `CHECKPOINT_CURRENT_VERSION = 2`。
- `checkpointMigrations` 保持空映射（DROP 重建后无 v1 存量行，无需 v1→v2 懒迁移）。

## 存储层

`packages/core/src/agent/checkpoint.ts`（接口）+ `packages/libsql-adapter/src/libsql-checkpoint-store.ts` + `packages/mysql-adapter/src/mysql-checkpoint-store.ts`

### 表结构

```sql
CREATE TABLE vico_checkpoints (
  id TEXT PRIMARY KEY,        -- 全局 uuid
  parent_id TEXT,             -- 上一版本 id（可跨 turn），根为 NULL
  turn_id TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  step_index INTEGER NOT NULL,
  next_action TEXT NOT NULL,  -- model | tool-approval | end
  snapshot TEXT NOT NULL,     -- 完整 Checkpoint JSON（含 id/parentId 与平铺字段）
  created_at INTEGER NOT NULL,
  UNIQUE (turn_id, version)
);
```

平铺列（id/parent_id/step_index/next_action）与 snapshot 内字段冗余，便于 SQL 查询/索引，与现状一致。

### CheckpointStore 接口变化

```typescript
export interface CheckpointStore {
  create(turnId: string, threadId: string): Promise<Checkpoint>;
  // parentId 显式入 patch；version = 该 turn max+1；生成新 uuid id
  append(turnId: string, patch: CheckpointAppendPatch): Promise<Checkpoint>;
  getLatest(turnId: string): Promise<Checkpoint | undefined>;   // 保留：线性场景便捷读取（version 最大）
  getVersion(turnId: string, version: number): Promise<Checkpoint | undefined>;  // 保留
  getById(id: string): Promise<Checkpoint | undefined>;          // 新增：父引用解析、指定叶恢复
  listVersions(turnId: string): Promise<Checkpoint[]>;           // 保留：version 升序
  fork(sourceTurnId: string, version: number, newTurnId: string, newThreadId: string): Promise<Checkpoint | undefined>;
  // fork 新 turn v1 的 parentId = 源版本 id（跨 turn 边）
  deleteByTurn(turnId: string): Promise<void>;                   // 不变
  purgeExpired(ttlMs: number): Promise<string[]>;                // 不变：按整链 created_at 删
}
```

### 版本树语义

- 血缘完全由 `parentId` 表达：turn 内兄弟分支（同一父多个子）、跨 turn fork 边（父在源 turn）。
- `version` 是 turn 内 append 序号，不表达树深；恢复/审计用 id 链回溯。
- `purgeExpired` 按 turn 整链删：跨 turn 引用（fork 子版本）在父 turn 被清后 parentId 悬空，属可接受审计语义（链独立存活），不做级联。

## resume 逻辑简化

`packages/core/src/agent/loop-agent.ts` + `loop-agent-options.ts`

### 单路径合并

当前双路径（有 pauseInfo → `applyPauseInfoRecovery`；无 → `findUnpairedToolCalls` 截断）合并为单路径：

```
读取目标 checkpoint（默认 getLatest，turn 内分叉场景由调用方显式指定叶版本/id）
→ 恢复历史消息（getEntriesByTurns + toModelMessages）
→ if nextAction === 'tool-approval':
     applyPauseInfoRecovery(平铺字段, decisions)   // 审批现场全量恢复
     append 'model' 版本（parentId = 恢复叶.id，pending 字段清空）
   else:
     findUnpairedToolCalls 消息链核对（gate 改为 nextAction !== 'tool-approval'）
     未配对 → 截断到该 assistant 消息之前，模型重新决策
→ updateTurn('running') → startTurnLoop(stepIndex, ...)
```

### 改动点

- `resumeTurn`（loop-agent.ts:336-390）：`!checkpoint.pauseInfo`（:357）→ `checkpoint.nextAction !== 'tool-approval'`；路径 A 的 append（:377-383）补 `parentId`、平铺字段清空。
- `applyPauseInfoRecovery`（:396-452）：入参从嵌套 `pauseInfo` 改为平铺字段；删 `reason` 检查（:397）；`if (x && x.length)` → `if (x.length)`。
- `runTurnLoop` pause/continue 分支（:544-571）：append patch 补 `parentId`（=`context.checkpoint.id`）+ 平铺字段。
- `executeModelStep` pause 构造（:630-641）：直接构造平铺字段，删 `reason`/`pausedAtStep`。
- `ModelStepResult.pauseInfo?: PauseInfo`（loop-agent-options.ts:13）：改平铺结构（`pendingApprovalCalls`/`approvedCalls`/`deniedResults`）。
- `createCheckpoint`（checkpoint.ts:84）：生成 uuid id、parentId=null、平铺字段空数组。

## 迁移

### DROP 重建

`packages/libsql-adapter/src/migrate.ts` + `packages/mysql-adapter/src/migrate.ts`

- 检测旧结构（`id` / `parent_id` 列缺失）：libsql 用 `PRAGMA table_info(vico_checkpoints)` 守卫，mysql 用 `INFORMATION_SCHEMA.COLUMNS` 守卫（沿用上一轮 final fix 的 pragma/INFORMATION_SCHEMA 守卫模式）。
- 命中 → `DROP TABLE vico_checkpoints` 后重建新结构。
- 历史版本链清零（用户确认接受）。

### 适配器同步

- `toRow`（libsql-checkpoint-store.ts:117）：snapshot 序列化含 id/parentId；行写入含 id/parent_id。
- `getLatest`：`JSON.parse(snapshot)` + `migrate`（schemaVersion=2，链为空无需升级）。
- mysql 适配器同样重建表 + 行读写补 id/parent_id。

## 崩溃恢复语义

- Checkpoint **不记录逐调用执行状态**。崩溃恢复能力边界：
  - 结果已落链的调用 → 消息链配对完整 → 跳过（不重跑）。
  - 结果未落链的调用 → 未配对 → 截断重决策（模型重新决策，可能重调同一工具）。
  - 工具执行中途崩溃（外部副作用可能已发生但结果未落库）→ 视为未执行 → 重决策 → 副作用可能执行两次。
- 副作用幂等是工具实现者的职责，本设计不提供引擎层去重。文档化声明该边界。

## 非目标

- 不引入逐调用执行状态追踪（executing/done/failed）。
- 不做 fork API 编排（新端点 + 消息链复制 + createTurn(forkedFrom) 串联）——该停驻项另立设计，落地时需把 resumeTurn 的新 userMessages 接入消息链（pre-existing）。
- 不改动消息链核对 / 截断算法本身（仅改 gate 条件）。
- 不修 mysql `vico_threads` 缺 user_id/metadata 列漂移（pre-existing，另立）。

## 测试

- `checkpoint.ts`：类型/`createCheckpoint` 默认值单测。
- libsql/mysql store：append 生成递增 version + 显式 parentId、`getById`、fork 跨 turn parentId、DROP 重建迁移。
- `loop-agent.test.ts`：审批恢复（nextAction='tool-approval' → applyPauseInfoRecovery）、拒绝分支、消息链截断（nextAction='model' → findUnpairedToolCalls）三条路径在单路径下行为不变。
