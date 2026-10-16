# Thread / Turn Token 用量聚合

> 生成日期：2026-10-17
> 目标：记录每个 turn 与每个 thread 的 token 花费，并在 thread 列表展示总量

## 一、背景

此前只持久化了「单条 assistant 消息」的用量——每次模型调用的完整 `UsageMetrics` 落在
`vico_messages.metadata.usage`（写入点 `packages/core/src/thread/utils.ts` 的 `fromModelMessage`）。

缺失的是聚合维度：

- **turn 级**：一个 turn 内 loop 多 step 会产生多次模型调用，引擎里虽已用 `addUsage` 累加出
  turn 总量（`loop-agent.ts` 的 `startTurnLoop`），但没有落库。
- **thread 级**：所有 turn 的用量之和，完全没有记录。

## 二、方案决策

1. **存储形态**：`usage` 作为 `metadata` 的一个子项，而非独立列。
   - `vico_turns.metadata.usage`、`vico_threads.metadata.usage`（JSON）。
   - 复用现有 metadata 的 JSON 序列化/反序列化通道，零 schema 迁移。
2. **统计口径**：thread 总量按「实际消费」累计，分叉/重新生成产生的旧 turn 同样计入。
3. **历史数据**：不回填（只保证新数据正确）。

## 三、实现

### 类型层（`packages/core/src/thread/thread-store.ts`）

- `ThreadMetadata` 增加 `usage?: UsageMetrics`。
- `TurnMetadata` 增加 `usage?: UsageMetrics`。

### 引擎写入（`packages/core/src/agent/loop-agent.ts`）

| 时机 | 位置 | 行为 |
|------|------|------|
| 恢复暂停 turn | `startTurn` 初始化 context | `context.usage = session.turn.metadata?.usage ?? emptyUsage()`，跨暂停不丢量 |
| 暂停 | `runTurnLoop` 的 pause 分支 | `updateTurn(turn.id, { status:'paused', steps, metadata:{ ...turn.metadata, usage: addUsage(context.usage, usage) } })`，写快照 |
| 失败 | `startTurnLoop` 的 failed 分支 | `updateTurn(turn.id, { status:'failed', steps, metadata:{ ...turn.metadata, usage } })` |
| 完结 | `startTurnLoop` 的 completed 分支 | 先写 turn `metadata.usage`，再 `addUsage(thread.metadata?.usage ?? emptyUsage(), usage)` 累加回 thread `metadata.usage` |

关键点：

- `startTurnLoop` 里 `usage = addUsage(context.usage, loopResult.usage)`，其中 `context.usage`
  是恢复时的历史累计，`loopResult.usage` 是本次 loop 累计，两者相加才是 turn 完整总量。
- 暂停分支写在 `runTurnLoop` 内部而非 `startTurnLoop`，因为 turn 的 `status='paused'` 在那里
  已经落库一次，此处顺势补 usage 快照，避免二次更新。
- thread 累计放在 turn 完结后；每次 HTTP 请求都会经 `resolveThread` 重新从 DB 读 thread，
  因此 `session.thread.metadata?.usage` 即最新累计值，per-turn 锁内串行，无并发丢失。

### 前端展示

- 抽共享工具 `packages/web/src/lib/token-format.ts`：`formatTokens`（缩写）+ `totalTokens`（输入+输出总量）。
- `message-token-usage.aui.tsx` 改用共享工具（删本地 `formatTokens`/`addTokens`）。
- 管理后台 `pages/Threads.tsx` 线程列表新增「Tokens」列，读 `thread.metadata.usage` 显示总量。
- i18n：`threads.json` 三个语言各加 `columnTokens`。

## 四、边界

- **分叉（fork/regenerate）**：新 turn 独立统计，thread 累计含分叉调用（实际消费口径）。
- **暂停/恢复**：turn 的 `metadata.usage` 在暂停时写快照，恢复后继续累加，不丢量。
- **压缩归档**：`vico_messages.archived` 软删除只影响模型上下文，不影响 turn/thread 级 usage。
- **历史数据**：不回填，旧 thread 的 `metadata.usage` 为空，前端 `formatTokens(undefined)` 显示占位符。

## 五、后续可选

- 聊天侧边栏（assistant-ui `ThreadList`）的列表项暂不展示 token：`RemoteThreadListAdapter`
  的 `RemoteThread` 结构不承载自定义字段，需要在 adapter 外挂 map 或扩展类型，成本较高。
- turn 级明细展示（如需）：`vico_turns.metadata.usage` 已就绪，可接 observability/evals 或 turn 列表 UI。
