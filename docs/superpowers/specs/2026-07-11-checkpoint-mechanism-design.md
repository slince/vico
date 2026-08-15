# Checkpoint 机制设计规范

> 状态：待审核 | 日期：2026-07-11 | 版本：1.0

---

## 一、背景与目标

### 1.1 当前问题

Vico Agent 引擎的长任务恢复、会话暂停、工具审批三个机制共享 `agent-loop.ts` 中的同一块代码，存在以下已识别问题：

| 问题 | 严重度 | 状态 |
|------|--------|------|
| `on-request` 工具每 step 都需重新审批 | P0 | 已修复（2026-07-11） |
| 进程崩溃后工具重复执行 | P0 | 已修复（2026-07-11） |
| `toolApprovalState` 恢复时丢失 | P1 | 待解决 |
| 无卡死 turn 超时机制 | P1 | 待解决 |
| `PauseInfo` 无版本号，结构变更不可迁移 | P2 | 待解决 |
| 愈合模式只看最后一条 assistant 消息 | P2 | 待解决 |
| heal/恢复逻辑无测试覆盖 | P2 | 待解决 |
| TOCTOU 并发窗口 | P2 | 待解决 |

### 1.2 设计目标

引入一个 **tool 级粒度的 checkpoint 机制**，作为 turn 执行过程中所有恢复操作的唯一权威数据源。Checkpoint 应：

1. 精确追踪每个 tool 的执行状态，消除"猜测式愈合"
2. 自带版本号，支持结构变更后的惰性迁移
3. 与现有 `ThreadStore` 明确分工——checkpoint 管恢复状态，threadStore 管消息持久化
4. 支持进程崩溃恢复、工具审批暂停恢复、并发幂等恢复三种场景
5. 替代而非叠加 `PauseInfo` 在 `turn.metadata` 中的存储

---

## 二、数据模型

### 2.1 核心类型

```typescript
/** Checkpoint schema 当前版本 */
const CHECKPOINT_CURRENT_VERSION = 1;

/** 单个 checkpoint 的完整数据结构 */
interface Checkpoint {
  id: string;                        // uuid
  turnId: string;                    // 所属 turn（unique，一个 turn 只有一条记录）
  threadId: string;                  // 所属 thread（冗余，加速查询 + purge 级联）
  version: number;                   // schema 版本号，惰性迁移

  // ── 控制字段 ──
  stepIndex: number;                 // 当前 step 编号
  toolApprovalState: Record<string, boolean>;  // toolName → approved
  pauseInfo: PauseInfo | null;       // 暂停中时的审批信息（此为 pauseInfo 唯一归属）

  // ── 消息链引用（轻量校验，不存消息内容） ──
  messageCount: number;              // 消息链长度，与 threadStore 加载结果比对
  lastMessageId: string | null;      // 末尾消息 ID，O(1) 快速比对

  // ── 工具执行追踪（自包含恢复，不依赖 threadStore 判定工具状态） ──
  completedToolCallIds: string[];    // 本 turn 已执行完毕的 toolCallId
  completedToolResults: ToolResult[];// 已执行工具的结果（恢复时直接追加，不重放）
  pendingToolCall: { id: string; name: string; args: Record<string, unknown> } | null;  // 即将执行的工具（含完整参数）

  createdAt: number;                 // Date.now()
  updatedAt: number;
}
```

### 2.2 字段设计原则

- **自包含恢复**：`completedToolResults` 存完整结果，恢复时不依赖 threadStore 做工具状态判定
- **轻量校验**：`messageCount` + `lastMessageId` 快速校验消息链完整性，不存消息内容（消息从 threadStore 加载）
- **单行 per turn**：原地 upsert，最新 checkpoint = 最完整快照，不需要历史版本链
- **pauseInfo 唯一归属**：从 `turn.metadata` 迁移到 checkpoint，消除冗余

### 2.3 与现有数据的关系

```
thread                    turn                       checkpoint
┌──────────┐           ┌──────────┐               ┌──────────────┐
│ metadata │           │ status   │──────────────→│ pauseInfo    │
│ workspace│           │ steps    │  单行 upsert    │ stepIndex    │
│ ...      │           │ ...      │               │ toolApproval │
└──────────┘           └──────────┘               │ completed... │
      │                     │                     │ pendingTool  │
      ▼                     ▼                     └──────┬───────┘
┌──────────┐           ┌──────────┐                      │
│ threadStore           │ messages │                      │ 恢复时：校验
│ .getThread()         │ ...      │◄─────────────────────┤ messageCount
│ .createTurn()        └──────────┘                      │ lastMessageId
│ .getEntriesByTurns()                                   │
└──────────┘                                             │
                                                         │
                                               threadStore 仍负责：
                                               消息持久化 + 消息加载
                                               checkpoint 只存引用
```

---

## 三、存储 Schema

### 3.1 数据库表（LibSQL / SQLite）

```sql
CREATE TABLE checkpoints (
  id            TEXT PRIMARY KEY,
  turn_id       TEXT NOT NULL UNIQUE,
  thread_id     TEXT NOT NULL,
  version       INTEGER NOT NULL DEFAULT 1,

  -- 高频查询字段（列级索引，避免 JSON 解析）
  step_index    INTEGER NOT NULL DEFAULT 0,
  paused        INTEGER NOT NULL DEFAULT 0,   -- 1 = 暂停中
  pending_tool  TEXT,                          -- JSON {id, name} | NULL

  -- 完整快照
  snapshot      TEXT NOT NULL,                 -- Checkpoint 完整 JSON

  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);

CREATE INDEX idx_checkpoints_thread_id ON checkpoints(thread_id);
CREATE INDEX idx_checkpoints_created_at ON checkpoints(created_at);
```

### 3.2 轻量列 vs snapshot 的分工

| 查询意图 | 方式 | 性能 |
|----------|------|------|
| "这个 turn 是否暂停？" | `WHERE turn_id = ? AND paused = 1` | O(1)，不走 JSON 解析 |
| "待执行什么工具？" | 读 `pending_tool` 列 | O(1)，不走 JSON 解析 |
| "恢复时完整还原" | `SELECT snapshot` → `JSON.parse` | 一次 parse |
| "清理过期" | `DELETE WHERE created_at < ?` | 批量索引扫描 |

### 3.3 CheckpointStore 接口

```typescript
interface CheckpointStore {
  /** 创建或原地更新（upsert on turn_id） */
  save(turnId: string, threadId: string, patch: Partial<Checkpoint>): Promise<Checkpoint>;

  /** 获取 turn 的最新 checkpoint */
  getByTurn(turnId: string): Promise<Checkpoint | undefined>;

  /** 批量获取同一 thread 的 checkpoints */
  listByThread(threadId: string): Promise<Checkpoint[]>;

  /** turn 完结后删除 */
  deleteByTurn(turnId: string): Promise<void>;

  /** 全局 TTL 清理：删除过期 checkpoint，返回被清理的 paused turn ID 列表 */
  purgeExpired(ttlMs: number): Promise<string[]>;
}
```

---

## 四、创建时机

### 4.1 写入点

Checkpoint 更新发生在 turn 生命周期内的 4 个关键状态转换点：

```
Turn 生命周期：

  startTurn / resumeTurn
    │
    ▼
  [CKPT: step-start]          ← stepIndex++，pendingToolCall = null
    │
    ▼
  callModel()
    │
    ▼
  resolveToolApprovals()
    │
    ├─ 有需审批工具
    │    │
    │    ▼
    │  [CKPT: paused]         ← pauseInfo = {...}, toolApprovalState 快照, paused = 1
    │    │
    │    ▼
    │  (等待客户端审批，turn 暂停)
    │
    └─ 全部可自动处理
         │
         ▼
       for each tool:
         │
         ├─ [CKPT: tool-pre]  ← pendingToolCall = {id, name}
         │                          
         ├─ execute()
         │                     ← 崩溃在此 → 恢复时看到 pendingToolCall 非空，重试
         │
         └─ [CKPT: tool-done]  ← completedToolCallIds.push(id)
                                  completedToolResults.push(result)
                                  pendingToolCall = null
```

### 4.2 写入频率分析

一个 5-step、每 step 3 个工具的 turn：step-start × 5 + tool-pre × 15 + tool-done × 15 = **35 次写入**。每次写入是单行 upsert，SQLite WAL 模式下写入开销约 0.05-0.1ms。35 次写入对 turn 总耗时（LLM 调用 + 工具执行，通常 5-30 秒）的影响可忽略。

### 4.3 为什么是"单行 per turn，原地覆盖"

- 不需要历史版本链——这不是审计日志，是恢复机制。最新状态就是最完整状态
- 单行 upsert 写入极快（无索引变更，只有主键冲突 → update）
- 并发场景天然互斥：两个请求同时 update 同一行，SQLite 的隐式行锁串行化写入

---

## 五、恢复流程

### 5.1 三种恢复路径

```
resumeTurn()
  │
  ├─ checkpointStore.getByTurn(turnId) 存在
  │     │
  │     ├─ pauseInfo != null
  │     │     → 审批恢复路径（5.2）
  │     │
  │     ├─ pendingToolCall != null
  │     │     → 工具重试路径（5.3）
  │     │
  │     └─ pendingToolCall == null
  │           → 直接继续执行路径（5.4）
  │
  └─ checkpoint 不存在（旧数据兼容）
        → 降级到现有 heal 模式（findUnresolvedToolCalls）
```

### 5.2 路径 A：审批恢复（pauseInfo != null）

```
1. messages = threadStore.getEntriesByTurns([turnId])
2. 校验 messages.length === checkpoint.messageCount
3. 还原 toolApprovalState: Map(checkpoint.toolApprovalState)
4. 还原 completedToolResults → 逐条检查消息链，跳过已有的（并发保护）
5. 从客户端获取 approvalDecisions
6. 按 pauseInfo.pendingToolCalls 分类：批准的执行 + 拒绝的注入 error
7. 更新 checkpoint: pauseInfo = null, paused = 0
8. 进入 startTurnLoop(checkpoint.stepIndex)
```

### 5.3 路径 B：工具重试（pendingToolCall != null）

```
1. messages = threadStore.getEntriesByTurns([turnId])
2. 校验
3. 还原 completedToolResults → 跳过已有的
4. 执行前检查：消息链中是否已有 pendingToolCall.id 的 tool_result？
   ├─ 有 → 并发请求已执行，从消息链提取结果，更新 checkpoint（跳过执行）
   └─ 无 → 执行该工具，持久化结果，更新 checkpoint
5. 进入 startTurnLoop(checkpoint.stepIndex)
```

`resolvePendingTool()` 的执行前检查逻辑：

```typescript
async function resolvePendingTool(
  pending: { id: string; name: string },
  checkpoint: Checkpoint,
  messages: ModelMessage[],
  context: TurnContext
): Promise<void> {
  // 1. 检查消息链中是否已有此 toolCall 的 tool_result（并发恢复可能已执行）
  const alreadyResolved = messages.some(
    m => m.role === 'tool' && m.toolCallId === pending.id
  );

  if (alreadyResolved) {
    // 跳过执行，从消息链提取已有结果
    const existingResult = messages
      .filter(m => m.role === 'tool' && m.toolCallId === pending.id)
      .map(m => ({ callId: m.toolCallId!, name: '', status: 'success' as const, output: m.content }));
    await checkpointStore.save(turnId, threadId, {
      completedToolCallIds: [...checkpoint.completedToolCallIds, pending.id],
      completedToolResults: [...checkpoint.completedToolResults, existingResult],
      pendingToolCall: null,
    });
    return;
  }

  // 2. 执行（pending 中已存完整 args，直接使用）
  const result = await this.toolBroker.execute(
    { id: pending.id, name: pending.name, args: pending.args },
    toolCallContext
  );
  await this.appendToolResults([result], context);
  await checkpointStore.save(turnId, threadId, {
    completedToolCallIds: [...checkpoint.completedToolCallIds, pending.id],
    completedToolResults: [...checkpoint.completedToolResults, result],
    pendingToolCall: null,
  });
}
```

### 5.4 路径 C：直接继续执行（pendingToolCall == null 且 pauseInfo == null）

```
1. messages = threadStore.getEntriesByTurns([turnId])
2. 校验
3. 还原 completedToolResults → 跳过已有的
4. stepIndex 检查：消息链中最后一条 assistant 的 toolCalls 是否全部已配对？
   ├─ 是 → 当前 step 已完成，可能需要进入下一个 step 或结束
   └─ 否 → 模型调用可能未完成，重新开始当前 step
5. 进入 startTurnLoop(checkpoint.stepIndex)
```

---

## 六、并发与幂等性

### 6.1 设计原则

```
Checkpoint  = "应该做什么"（意图）
Message 链  = "已经做了什么"（事实）

任何恢复动作执行前，先核对事实——如果消息链已显示完成，跳过意图。
```

### 6.2 并发场景推演

最坏情况：两个恢复请求同时到达，同时读到相同的 checkpoint（pendingToolCall != null）：

```
请求 A: read ckpt(pending=call_1) → execute(call_1) → persist → ckpt(done)
请求 B: read ckpt(pending=call_1) → execute(call_1) → persist → ckpt(done)
                                      ↑
                                   并发竞态窗口
```

对于 readonly 工具：双执行无副作用。对于 mutation 工具，依赖 **执行前检查**（5.3 节）消除重复执行——请求 B 在执行 call_1 前检查消息链，发现 call_1 的 tool_result 已存在（请求 A 已写入），直接跳过，从消息链提取已有结果。

### 6.3 不做什么

- 不引入分布式锁
- 不引入 CAS 写入
- 不阻止并发恢复——并发是预期行为，不是 bug

### 6.4 并发写入的安全性

SQLite WAL 模式下，两个连接同时对同一行做 upsert 会被串行化。后完成的写入覆盖先完成的写入。由于两个写入内容相同（都是标记 call_1 完成），覆盖无害。

---

## 七、版本迁移

### 7.1 迁移链

```typescript
const checkpointMigrations: Record<number, (snapshot: Record<string, unknown>) => Record<string, unknown>> = {
  // 示例：v1 → v2
  // 1: (s) => ({ ...s, version: 2, executionTimeline: buildTimeline(s) }),
};
```

### 7.2 读写路径

**读（`getByTurn`）——惰性升级：**

```typescript
async getByTurn(turnId: string): Promise<Checkpoint | undefined> {
  const row = await db.select().from(checkpoints).where(eq(checkpoints.turnId, turnId)).get();
  if (!row) return undefined;

  let snapshot = JSON.parse(row.snapshot);
  while (snapshot.version < CHECKPOINT_CURRENT_VERSION) {
    const migrate = checkpointMigrations[snapshot.version];
    if (!migrate) break; // 缺少迁移函数，尽力而为
    snapshot = migrate(snapshot);
  }
  return snapshot as Checkpoint;
}
```

**写（`save`）——始终输出最新版本：**

```typescript
async save(turnId: string, threadId: string, patch: Partial<Checkpoint>): Promise<Checkpoint> {
  const existing = await this.getByTurn(turnId); // 读时自动升级
  const merged = { ...existing, ...patch, version: CHECKPOINT_CURRENT_VERSION, updatedAt: Date.now() };
  await db.insert(checkpoints).values(toRow(merged)).onConflictDoUpdate(turnId).set(toRow(merged));
  return merged;
}
```

### 7.3 迁移示例：v1 → v2（新增 executionTimeline 字段）

```typescript
checkpointMigrations[1] = (s: Record<string, unknown>) => ({
  ...s,
  version: 2,
  executionTimeline: ((s.completedToolResults ?? []) as ToolResult[]).map(r => ({
    callId: r.callId,
    name: r.name,
    status: r.status,
  })),
});
```

### 7.4 回退兼容

部署回滚到旧版本时：
- 旧代码的 `CHECKPOINT_CURRENT_VERSION = 1`
- 新版本写的 checkpoint（version=2）：`while (2 < 1)` 跳过迁移
- 旧代码忽略 `executionTimeline` 字段（JSON 中多余字段不影响解析）
- 降级损失：丢失新字段的信息，但核心恢复能力不受影响

---

## 八、生命周期与清理

### 8.1 清理策略

| Turn 状态 | Checkpoint 处理 | 原因 |
|-----------|----------------|------|
| `running`（正常执行中） | 三步写入（step-start → tool-pre → tool-done） | 活跃使用 |
| `completed` | **立即删除** | 唯一不需要恢复的终态 |
| `paused` | 保留 | 等待审批恢复 |
| `aborted` | 保留 | 用户手动取消后可能重试 |
| `failed` | 保留 | 用户可能手动重试 |
| `running`（进程崩溃） | 保留 | 下一次请求触发自动恢复 |

### 8.2 全局 TTL 兜底

```typescript
/** 默认 checkpoint 存活时间：7 天 */
const DEFAULT_CHECKPOINT_TTL = 7 * 24 * 60 * 60 * 1000;

/**
 * 清理过期 checkpoint + 级联更新 turn 状态。
 * 建议通过定时任务（每小时）或 Agent 启动时调用。
 */
async function purgeExpired(ttlMs: number = DEFAULT_CHECKPOINT_TTL): Promise<string[]> {
  const cutoff = Date.now() - ttlMs;
  const expired = await db
    .select({ turnId: checkpoints.turnId })
    .from(checkpoints)
    .where(lt(checkpoints.createdAt, cutoff))
    .all();

  // 删除过期记录
  await db.delete(checkpoints).where(lt(checkpoints.createdAt, cutoff)).run();

  // 将对应的 paused turn 标记为 failed（checkpoint 丢失后不可恢复）
  const pausedTurnIds = expired
    .filter(r => r.paused === 1)
    .map(r => r.turnId);

  for (const turnId of pausedTurnIds) {
    await threadStore.updateTurn(turnId, { status: 'failed' });
  }

  return pausedTurnIds;
}
```

### 8.3 定时清理触发建议

两个调用点：
1. Agent 启动时调用一次 `purgeExpired()`
2. 建议部署方配置 cron：`0 * * * *`（每小时一次），通过管理 API 触发

---

## 九、与现有代码的整合

### 9.1 改动的文件

| 文件 | 改动类型 | 说明 |
|------|---------|------|
| `packages/agent/src/agent-loop/agent-loop.ts` | 重构 | `executeModelStep`、`executeToolCalls`、`resumeTurn`、`healTurnMessages`、`applyPauseInfoRecovery` |
| `packages/agent/src/agent-loop/agent-loop-options.ts` | 删除 | 删除 `PauseInfo` 类型（迁移到 checkpoint 模块） |
| `packages/agent/src/agent-loop/checkpoint.ts` | **新文件** | Checkpoint 类型 + CheckpointStore 接口 + 迁移函数 |
| `packages/agent/src/agent-loop/checkpoint-store.ts` | **新文件** | CheckpointStore 实现（基于 Drizzle） |
| `packages/libsql-adapter/src/schema.ts` | 新增 | `checkpoints` 表定义 |
| `packages/libsql-adapter/src/checkpoint-store.ts` | **新文件** | LibSQL CheckpointStore 实现 |
| `packages/agent/src/index.ts` | 新增导出 | 导出 Checkpoint 相关类型和接口 |

### 9.2 PauseInfo 迁移

`PauseInfo` 类型从 `loop-agent-options.ts` 迁移到 `agent-loop/checkpoint.ts`，作为 checkpoint 模块的内部类型。`turn.metadata.pauseInfo` 不再写入。

**迁移路径**：

```
Before: turn.metadata.pauseInfo (loop-agent-options.ts)
After:  Checkpoint.pauseInfo (agent-loop/checkpoint.ts)

turn.metadata 中旧数据：不主动清理，读取时忽略
```

### 9.3 executeToolCalls 整合

当前 P0-2 修复后的 `executeToolCalls` 已实现逐条执行 + 立即持久化。整合 checkpoint 后，唯一的改动是在 `executeAndPersist` 中添加 tool-pre 和 tool-done 的 checkpoint 写入：

```typescript
const executeAndPersist = async (call: ToolCall): Promise<ToolResult> => {
  // tool-pre checkpoint（含完整 args，恢复时无需查消息链）
  await this.checkpointStore.save(turnId, threadId, {
    pendingToolCall: { id: call.id, name: call.name, args: call.args },
    stepIndex: currentStep,
  });

  // 执行
  const result = await this.toolBroker.execute(call, ctx);

  // tool-done checkpoint
  await this.checkpointStore.save(turnId, threadId, {
    completedToolCallIds: [...prev, call.id],
    completedToolResults: [...prevResults, result],
    pendingToolCall: null,
  });

  // 持久化消息（已有逻辑）
  await this.appendToolResults([result], context);
  this.emit({ type: 'tool-result', ... });
  return result;
};
```

### 9.4 resumeTurn 简化

**Before**（当前代码 L171-231）:
```typescript
private async resumeTurn(params): Promise<TurnResult> {
    // 加载消息
    const entries = await this.agent.thread.getEntriesByTurns([turn.id]);
    const messages = toModelMessages(entries);

    // 重建 context（toolApprovalState 是空 Map）
    const toolApprovalState = new Map<string, boolean>();

    // 分支：pauseInfo 恢复 vs heal
    const pauseInfo = turn.metadata?.pauseInfo as PauseInfo | undefined;
    if (pauseInfo) {
      await this.applyPauseInfoRecovery(pauseInfo, approvalDecisions, context);
      startStep = pauseInfo.pausedAtStep + 1;
    } else {
      const healResult = await this.healTurnMessages(messages, context, ...);
      if (healResult) return healResult;
    }

    messages.push(userMessage);
    await this.persistMessage(userMessage, context);
    await this.agent.thread.updateTurn(turn.id, { status: 'running' });
    return this.startTurnLoop(startStep, context, turnSpan, usage);
}
```

**After**:
```typescript
private async resumeTurn(params): Promise<TurnResult> {
    const messages = toModelMessages(await this.agent.thread.getEntriesByTurns([turn.id]));
    const checkpoint = await this.checkpointStore.getByTurn(turn.id);

    if (checkpoint) {
      // 校验 + 从 checkpoint 精确恢复
      this.validateCheckpoint(checkpoint, messages);

      // 还原 toolApprovalState（不再从空 Map 开始）
      const toolApprovalState = new Map(Object.entries(checkpoint.toolApprovalState));

      // 还原已完成的工具结果（跳过已在消息链中的）
      for (const result of checkpoint.completedToolResults) {
        if (!messages.some(m => m.role === 'tool' && m.toolCallId === result.callId)) {
          messages.push({ role: 'tool', content: this.resolveToolResult(result), toolCallId: result.callId });
        }
      }

      if (checkpoint.pauseInfo) {
        // 路径 A：审批恢复
        await this.applyPauseInfoRecovery(checkpoint.pauseInfo, approvalDecisions, context);
      } else if (checkpoint.pendingToolCall) {
        // 路径 B：工具重试
        await this.resolvePendingTool(checkpoint.pendingToolCall, checkpoint, messages, context);
      }
      // 路径 C：直接继续执行（pendingToolCall 为空）

      messages.push(userMessage);
      await this.persistMessage(userMessage, context);
      await this.agent.thread.updateTurn(turn.id, { status: 'running' });
      return this.startTurnLoop(checkpoint.stepIndex, context, turnSpan, usage);

    } else {
      // 降级到现有 heal 模式（兼容旧数据——没有 checkpoint 记录的旧 turn）
      // legacyHealResume 即当前代码中的 healTurnMessages + applyPauseInfoRecovery 逻辑
      return this.legacyHealResume(params);
    }
}
```

---

## 十、风险与缓解

| 风险 | 影响 | 缓解 |
|------|------|------|
| Checkpoint 写入失败 | 恢复时状态不准确 | tool-done 写入失败不影响执行结果（结果已持久化到消息链），仅影响下次恢复的精确度。下次恢复降级到 heal 模式 |
| Checkpoint 与消息链不一致 | 恢复时额外或遗漏的工具调用 | `messageCount` + `lastMessageId` 校验检测不一致，检测到后丢弃 checkpoint 降级到 heal |
| 大量 paused turn 堆积 | 存储占用 | TTL 兜底自动清理 |
| 版本迁移逻辑错误 | 旧 checkpoint 恢复失败 | 迁移失败时丢弃 checkpoint 降级到 heal，不阻塞 turn 执行 |
| SQLite 并发写入冲突 | 两个恢复请求同时更新 checkpoint | WAL 模式隐式行锁串行化，先完成的写入被后完成的覆盖，内容相同无副作用 |

---

## 十一、未来扩展

### 11.1 多 turn 级联恢复

当前 checkpoint 是单 turn 的。如果未来需要跨 turn 恢复（如"从这个对话的第 3 轮继续"），可以将 `thread.metadata` 中的 checkpoint 摘要改为 `{ latestCheckpointId, latestTurnId }` 指回完整的 checkpoint 记录。

### 11.2 可视化恢复状态

Checkpoint 的 `completedToolCallIds` 和 `completedToolResults` 提供了精确的工具执行历史，可以用于：
- 前端的"恢复预览"——显示哪些步骤已完成、哪些待重试
- 调试工具——回放整个 turn 的工具调用链

### 11.3 审计日志

如果未来需要完整的审计轨迹，可以在当前"单行 per turn"基础上，增加一个 `checkpoint_log` 表存储每次 checkpoint 变更的历史记录（append-only），与恢复用的最新 checkpoint 分开。
