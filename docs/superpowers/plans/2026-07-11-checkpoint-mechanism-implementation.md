# Checkpoint 机制实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 引入 tool 级粒度的 checkpoint 机制，替代 turn.metadata.pauseInfo 成为 turn 恢复的唯一权威数据源，解决工具重复执行、审批状态丢失、PauseInfo 无版本化等问题。

**Architecture:** 新增 `Checkpoint` 类型与 `CheckpointStore` 接口（独立模块），新增 `checkpoints` 数据库表（单行 per turn 原地 upsert），重构 AgentLoop 的 executeToolCalls / resumeTurn / executeModelStep 集成 checkpoint 写入与恢复，保留旧 heal 逻辑作为降级路径。

**Tech Stack:** TypeScript, Drizzle ORM, LibSQL/SQLite, Vitest

## Global Constraints

- 所有新代码需通过 `tsc --noEmit` 类型检查
- `PauseInfo` 类型从 `loop-agent-options.ts` 迁移到 `checkpoint.ts`，旧引用全部更新
- turn.metadata.pauseInfo 不再写入，读取时忽略
- 保留 `findUnresolvedToolCalls()` 和现有 heal 逻辑作为 checkpoint 缺失时的降级路径
- 每次 checkpoint 写入是单行 upsert（on turn_id conflict），不产生历史行

---

## File Structure

| 文件 | 职责 | 改动 |
|------|------|------|
| `packages/agent/src/agent-loop/checkpoint.ts` | Checkpoint 类型 + PauseInfo + CheckpointStore 接口 + 迁移链 + 常量 | **新增** |
| `packages/agent/src/agent-loop/checkpoint-store.ts` | 内存版 CheckpointStore 实现（测试/非SQL用） | **新增** |
| `packages/agent/src/agent-loop/agent-loop-options.ts` | 移除 PauseInfo，CheckpointStore 注入到 AgentLoopOptions | **修改** |
| `packages/agent/src/agent-loop/agent-loop.ts` | 集成 checkpoint 写入与恢复 | **修改** |
| `packages/agent/src/agent-loop/utils.ts` | buildLoop 不传 checkpointStore（使用默认 in-memory） | **不修改** |
| `packages/agent/src/index.ts` | 导出 Checkpoint 相关类型 | **修改** |
| `packages/libsql-adapter/src/schema.ts` | 新增 checkpoints 表定义 | **修改** |
| `packages/libsql-adapter/src/checkpoint-store.ts` | LibSQL 版 CheckpointStore 实现 | **新增** |
| `packages/agent/__tests__/checkpoint.test.ts` | Checkpoint 类型/迁移/Store 单元测试 | **新增** |
| `packages/agent/__tests__/agent-loop-checkpoint.test.ts` | AgentLoop + checkpoint 集成测试 | **新增** |

---

### Task 1: 创建 Checkpoint 类型与接口

**Files:**
- Create: `packages/agent/src/agent-loop/checkpoint.ts`

**Interfaces:**
- Produces: `Checkpoint`, `CHECKPOINT_CURRENT_VERSION`, `checkpointMigrations`, `CheckpointStore` interface, `PauseInfo`（迁移）

- [ ] **Step 1: 创建 checkpoint.ts**

```typescript
// @vico/agent - Checkpoint 类型 + CheckpointStore 接口 + 版本迁移
import type { ToolCall, ToolResult } from '../tool/types.js';

/** Checkpoint schema 当前版本 */
export const CHECKPOINT_CURRENT_VERSION = 1;

/** turn 暂停原因及恢复所需信息（从 loop-agent-options.ts 迁移） */
export interface PauseInfo {
  reason: 'tool-approval' | 'error';
  pendingToolCalls: ToolCall[];
  autoApprovedCalls?: ToolCall[];
  autoDeniedResults?: ToolResult[];
  pausedAtStep: number;
  messageCount: number;
}

/** 单个 checkpoint 的完整数据结构 */
export interface Checkpoint {
  id: string;
  turnId: string;
  threadId: string;
  version: number;

  stepIndex: number;
  toolApprovalState: Record<string, boolean>;
  pauseInfo: PauseInfo | null;

  messageCount: number;
  lastMessageId: string | null;

  completedToolCallIds: string[];
  completedToolResults: ToolResult[];
  pendingToolCall: { id: string; name: string; args: Record<string, unknown> } | null;

  createdAt: number;
  updatedAt: number;
}

/** CheckpointStore 接口 */
export interface CheckpointStore {
  save(turnId: string, threadId: string, patch: Partial<Checkpoint>): Promise<Checkpoint>;
  getByTurn(turnId: string): Promise<Checkpoint | undefined>;
  listByThread(threadId: string): Promise<Checkpoint[]>;
  deleteByTurn(turnId: string): Promise<void>;
  purgeExpired(ttlMs: number): Promise<string[]>;
}

/**
 * 版本迁移函数映射：version N → version N+1。
 * 每个函数只负责一个版本的升级。
 */
export const checkpointMigrations: Record<number, (snapshot: Record<string, unknown>) => Record<string, unknown>> = {
  // 示例：v1 → v2
  // 1: (s) => ({ ...s, version: 2, executionTimeline: buildTimeline(s) }),
};

/** 默认 checkpoint 存活时间：7 天 */
export const DEFAULT_CHECKPOINT_TTL = 7 * 24 * 60 * 60 * 1000;
```

- [ ] **Step 2: 验证类型检查**

```bash
pnpm --filter @vico/agent exec tsc --noEmit 2>&1 | grep -E "checkpoint" | head -10
```

Expected: no errors related to checkpoint.ts

- [ ] **Step 3: Commit**

```bash
git add packages/agent/src/agent-loop/checkpoint.ts
git commit -m "feat: add Checkpoint type and CheckpointStore interface"
```

---

### Task 2: 创建内存版 CheckpointStore

**Files:**
- Create: `packages/agent/src/agent-loop/checkpoint-store.ts`

**Interfaces:**
- Consumes: `CheckpointStore`, `Checkpoint`, `CHECKPOINT_CURRENT_VERSION`, `checkpointMigrations` from `checkpoint.ts`
- Produces: `InMemoryCheckpointStore` class

- [ ] **Step 1: 创建实现文件**

```typescript
// @vico/agent - InMemoryCheckpointStore implementation
import type { Checkpoint, CheckpointStore } from './checkpoint.js';
import { CHECKPOINT_CURRENT_VERSION, checkpointMigrations } from './checkpoint.js';

export class InMemoryCheckpointStore implements CheckpointStore {
  private store = new Map<string, Checkpoint>();

  async save(turnId: string, threadId: string, patch: Partial<Checkpoint>): Promise<Checkpoint> {
    const existing = this.store.get(turnId);
    const now = Date.now();

    if (existing) {
      const merged: Checkpoint = {
        ...existing,
        ...patch,
        version: CHECKPOINT_CURRENT_VERSION,
        updatedAt: now,
        // 数组字段需要合并而非覆盖
        completedToolCallIds: patch.completedToolCallIds ?? existing.completedToolCallIds,
        completedToolResults: patch.completedToolResults ?? existing.completedToolResults,
      };
      this.store.set(turnId, merged);
      return merged;
    }

    const created: Checkpoint = {
      id: `ckpt-${turnId}`,
      turnId,
      threadId,
      version: CHECKPOINT_CURRENT_VERSION,
      stepIndex: 0,
      toolApprovalState: {},
      pauseInfo: null,
      messageCount: 0,
      lastMessageId: null,
      completedToolCallIds: [],
      completedToolResults: [],
      pendingToolCall: null,
      createdAt: now,
      updatedAt: now,
      ...patch,
    };
    this.store.set(turnId, created);
    return created;
  }

  async getByTurn(turnId: string): Promise<Checkpoint | undefined> {
    const ckpt = this.store.get(turnId);
    if (!ckpt) return undefined;
    return this.migrate(ckpt);
  }

  async listByThread(threadId: string): Promise<Checkpoint[]> {
    const results: Checkpoint[] = [];
    for (const ckpt of this.store.values()) {
      if (ckpt.threadId === threadId) {
        results.push(this.migrate(ckpt));
      }
    }
    return results;
  }

  async deleteByTurn(turnId: string): Promise<void> {
    this.store.delete(turnId);
  }

  async purgeExpired(ttlMs: number): Promise<string[]> {
    const cutoff = Date.now() - ttlMs;
    const expiredTurnIds: string[] = [];
    for (const [turnId, ckpt] of this.store.entries()) {
      if (ckpt.createdAt < cutoff) {
        if (ckpt.pauseInfo !== null) {
          expiredTurnIds.push(turnId);
        }
        this.store.delete(turnId);
      }
    }
    return expiredTurnIds;
  }

  /** 惰性版本迁移 */
  private migrate(ckpt: Checkpoint): Checkpoint {
    let snapshot = ckpt as unknown as Record<string, unknown>;
    while ((snapshot.version as number) < CHECKPOINT_CURRENT_VERSION) {
      const migrateFn = checkpointMigrations[snapshot.version as number];
      if (!migrateFn) break;
      snapshot = migrateFn(snapshot);
    }
    return snapshot as unknown as Checkpoint;
  }
}
```

- [ ] **Step 2: 验证编译**

```bash
pnpm --filter @vico/agent exec tsc --noEmit 2>&1 | grep -E "checkpoint-(store|type)" | head -10
```

Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add packages/agent/src/agent-loop/checkpoint-store.ts
git commit -m "feat: add InMemoryCheckpointStore implementation"
```

---

### Task 3: 从 loop-agent-options.ts 迁移 PauseInfo

**Files:**
- Modify: `packages/agent/src/agent-loop/agent-loop-options.ts` — 删除 PauseInfo，改为从 checkpoint.ts re-export
- Modify: `packages/agent/src/agent-loop/agent-loop.ts` — 更新 PauseInfo 导入

**Interfaces:**
- Consumes: `PauseInfo` from `./checkpoint.js`
- Produces: (re-export for backward compat)

- [ ] **Step 1: 修改 loop-agent-options.ts**

删除 L77-91 的 PauseInfo 接口定义，替换为从 checkpoint 的 re-export：

```typescript
// 在 loop-agent-options.ts 顶部添加 import
import { PauseInfo } from './checkpoint.js';

// 删除原来的 export interface PauseInfo { ... }

// 已有的 re-export 保持不变（因为其他地方已经 import { PauseInfo } from 'agent-loop-options'）
export type { PauseInfo };
```

- [ ] **Step 2: 验证编译通过**

```bash
pnpm --filter @vico/agent exec tsc --noEmit 2>&1 | grep -i "pauseinfo\|PauseInfo" | head -10
```

Expected: no new errors related to PauseInfo

- [ ] **Step 3: Commit**

```bash
git add packages/agent/src/agent-loop/loop-agent-options.ts packages/agent/src/agent-loop/agent-loop.ts
git commit -m "refactor: migrate PauseInfo from agent-loop-options to checkpoint module"
```

---

### Task 4: 注入 CheckpointStore 到 AgentLoop

**Files:**
- Modify: `packages/agent/src/agent-loop/agent-loop.ts` — AgentLoopOptions 新增 checkpointStore，构造函数接收
- Modify: `packages/agent/src/agent-loop/agent-loop.ts` — 新增私有属性 `checkpointStore`

**Interfaces:**
- Consumes: `CheckpointStore` from `./checkpoint.js`
- Produces: `AgentLoopOptions.checkpointStore?: CheckpointStore`

- [ ] **Step 1: 修改 AgentLoopOptions 和构造函数**

在 `agent-loop.ts` 顶部添加 checkpoint 导入：

```typescript
import type { CheckpointStore } from './checkpoint.js';
import { InMemoryCheckpointStore } from './checkpoint-store.js';
```

修改 `AgentLoopOptions` 接口（L34-39）：

```typescript
export interface AgentLoopOptions {
  agent: Agent;
  processors?: ContextProcessor[];
  compactor?: ContextCompactor;
  tokenEconomy?: TokenEconomy;
  checkpointStore?: CheckpointStore;
}
```

修改构造函数（L52-60），在末尾添加 checkpointStore 初始化：

```typescript
constructor(options: AgentLoopOptions) {
  this.agent = options.agent;
  this.toolBroker = new ToolBroker(options.agent.tools);
  this.compactor = options.compactor;
  this.tokenEconomy = options.tokenEconomy;
  this.tracer = options.agent.tracer;
  this.approvalResolver = options.agent.approvalResolver ?? resolvePolicy;
  this.pipeline = new ProcessorPipeline(options.processors ?? []);
  this.checkpointStore = options.checkpointStore ?? new InMemoryCheckpointStore();
}
```

在类中添加 `checkpointStore` 属性声明（在 `private pipeline` 行之后）：

```typescript
private checkpointStore: CheckpointStore;
```

- [ ] **Step 2: 验证编译**

```bash
pnpm --filter @vico/agent exec tsc --noEmit 2>&1 | grep "agent-loop.ts" | grep -v "not exported" | head -10
```

Expected: no new errors

- [ ] **Step 3: Commit**

```bash
git add packages/agent/src/agent-loop/agent-loop.ts
git commit -m "feat: inject CheckpointStore into AgentLoop"
```

---

### Task 5: 在 executeToolCalls 中集成 checkpoint 写入

**Files:**
- Modify: `packages/agent/src/agent-loop/agent-loop.ts` — `executeToolCalls` 方法

**Interfaces:**
- Consumes: `this.checkpointStore.save()`

- [ ] **Step 1: 重构 executeAndPersist 内部函数**

修改 `executeToolCalls` 方法（L739-787）中的 `executeAndPersist` 闭包，在执行前后添加 checkpoint 写入：

```typescript
private async executeToolCalls(toolCalls: ToolCall[], context: TurnContext): Promise<ToolResult[]> {
  if (toolCalls.length === 0) return [];

  const toolSpan = context.trace.startSpan('tool_call', { count: toolCalls.length });
  const toolCallContext: ToolCallContext = {session: context.session, agentId: this.agent.id, signal: context.signal};
  const turnId = context.session.turn.id;
  const threadId = context.session.thread.id;

  // 按 kind 分组
  const readonlyCalls: ToolCall[] = [];
  const sequentialCalls: ToolCall[] = [];
  for (const call of toolCalls) {
    const tool = this.toolBroker.findTool(call.name);
    if (tool?.kind === 'readonly') {
      readonlyCalls.push(call);
    } else {
      sequentialCalls.push(call);
    }
  }

  // 最新 checkpoint 引用（闭包内异步更新）
  let latestCheckpoint = await this.checkpointStore.getByTurn(turnId);

  const executeAndPersist = async (call: ToolCall): Promise<ToolResult> => {
    // tool-pre checkpoint（含完整 args，恢复时无需查消息链）
    latestCheckpoint = await this.checkpointStore.save(turnId, threadId, {
      pendingToolCall: { id: call.id, name: call.name, args: call.args as Record<string, unknown> },
    });

    // 执行工具
    const result = await this.toolBroker.execute(call, toolCallContext);

    // tool-done checkpoint
    const prevIds = latestCheckpoint?.completedToolCallIds ?? [];
    const prevResults = latestCheckpoint?.completedToolResults ?? [];
    latestCheckpoint = await this.checkpointStore.save(turnId, threadId, {
      stepIndex: latestCheckpoint?.stepIndex ?? 0,
      completedToolCallIds: [...prevIds, call.id],
      completedToolResults: [...prevResults, result],
      pendingToolCall: null,
    });

    // 持久化消息 + 事件
    await this.appendToolResults([result], context);
    this.emit({
      type: 'tool-result',
      id: result.callId,
      name: result.name,
      status: result.status,
      output: result.output,
    });
    return result;
  };

  const results: ToolResult[] = [];

  // readonly 并行
  const readonlyResults = await Promise.all(readonlyCalls.map(executeAndPersist));
  results.push(...readonlyResults);

  // 非 readonly 串行
  for (const call of sequentialCalls) {
    results.push(await executeAndPersist(call));
  }

  toolSpan.end({ results: results.length });
  return results;
}
```

- [ ] **Step 2: 验证编译通过**

```bash
pnpm --filter @vico/agent exec tsc --noEmit 2>&1 | grep "agent-loop.ts" | head -10
```

- [ ] **Step 3: Commit**

```bash
git add packages/agent/src/agent-loop/agent-loop.ts
git commit -m "feat: integrate checkpoint writes into executeToolCalls"
```

---

### Task 6: 在 executeModelStep 中集成 checkpoint（step-start + paused）

**Files:**
- Modify: `packages/agent/src/agent-loop/agent-loop.ts` — `executeModelStep`，`runTurnLoop`

**Interfaces:**
- Consumes: `this.checkpointStore.save()`

- [ ] **Step 1: 在 executeModelStep 中添加 step-start checkpoint**

在 `executeModelStep` 方法开头（L428 emit 之后）添加：

```typescript
// step-start checkpoint：记录当前 step 进度
await this.checkpointStore.save(context.session.turn.id, context.session.thread.id, {
  stepIndex: step.index,
  pendingToolCall: null,
  messageCount: context.messages.length,
  lastMessageId: null,
  toolApprovalState: Object.fromEntries(context.toolApprovalState),
});
```

- [ ] **Step 2: 修改 paused 分支，写 checkpoint 而非 turn.metadata**

修改 L406-408（runTurnLoop 中的暂停处理），移除 `metadata: { pauseInfo }`：

```typescript
if (shouldPause && pauseInfo) {
  // 持久化暂停信息到 checkpoint（不再写入 turn.metadata）
  await this.checkpointStore.save(turn.id, context.session.thread.id, {
    pauseInfo,
    toolApprovalState: Object.fromEntries(context.toolApprovalState),
    messageCount: context.messages.length,
    stepIndex: steps,
  });
  await this.agent.thread.updateTurn(turn.id, { status: 'paused', steps });
  return { finalStatus: 'paused', steps, usage };
}
```

- [ ] **Step 3: 在 turn 完成时清理 checkpoint**

在 `startTurnLoop` 中 `finalStatus === 'completed'` 路径（L371 附近）添加清理：

```typescript
const finalStatus = loopResult.finalStatus === 'aborted' ? 'aborted' : 'completed';
await this.agent.thread.updateTurn(turn.id, { status: finalStatus, steps: loopResult.steps });

// completed 终态：清理 checkpoint
if (finalStatus === 'completed') {
  await this.checkpointStore.deleteByTurn(turn.id);
}
```

- [ ] **Step 4: 验证编译**

```bash
pnpm --filter @vico/agent exec tsc --noEmit 2>&1 | grep "agent-loop.ts" | head -10
```

- [ ] **Step 5: Commit**

```bash
git add packages/agent/src/agent-loop/agent-loop.ts
git commit -m "feat: integrate step-start and paused checkpoints into executeModelStep"
```

---

### Task 7: 重构 resumeTurn — 三条恢复路径

**Files:**
- Modify: `packages/agent/src/agent-loop/agent-loop.ts` — `resumeTurn` 方法，新增 `resolvePendingTool`、`legacyHealResume` 私有方法

**Interfaces:**
- Consumes: `this.checkpointStore.getByTurn()`, `Checkpoint`, `PauseInfo`
- Produces: `resolvePendingTool()`, `legacyHealResume()`

- [ ] **Step 1: 重写 resumeTurn 方法**

替换 L171-231 为以下实现：

```typescript
/** 从未完结的 turn 恢复执行，携带新的用户消息 */
private async resumeTurn(params: {
  thread: Thread;
  turn: Turn;
  userMessage: ModelMessage;
  signal: AbortSignal;
  controller: ReadableStreamDefaultController<ModelStreamChunk>;
  options?: RunOptions;
  usage: UsageMetrics;
}): Promise<TurnResult> {
  const { thread, turn, userMessage, signal, controller, options, usage } = params;

  // 加载消息
  const entries = await this.agent.thread.getEntriesByTurns([turn.id]);
  const messages: ModelMessage[] = toModelMessages(entries);

  const { scopeId, workspace: optWorkspace, approvalDecisions } = options || {};
  const workspace = optWorkspace ?? thread.metadata?.workspace ?? this.agent.workspace;

  // 重建 session 和 context
  const session: TurnSession = { workspace, scopeId, thread, turn };
  const trace = this.tracer.create(thread, userMessage, turn.id);
  const turnSpan = trace.startSpan('agent_resume');

  const requestContext = new ModelRequestContext({
    agent: this.agent,
    userMessage,
    tools: [...this.agent.tools],
    session,
  });
  await this.pipeline.enter(requestContext);

  // ——— checkpoint 恢复逻辑 ———
  const checkpoint = await this.checkpointStore.getByTurn(turn.id);

  if (checkpoint) {
    // 校验消息链完整性
    if (checkpoint.messageCount !== messages.length) {
      // 不一致 → 降级到 heal 模式
      await this.checkpointStore.deleteByTurn(turn.id);
      return this.legacyHealResume({ thread, turn, userMessage, signal, controller, options, usage, messages, trace, turnSpan, requestContext });
    }

    // 还原 toolApprovalState
    const toolApprovalState = new Map<string, boolean>(Object.entries(checkpoint.toolApprovalState));

    // 还原已完成工具结果到消息链（跳过已有的，并发保护）
    for (const result of checkpoint.completedToolResults) {
      if (!messages.some(m => m.role === 'tool' && m.toolCallId === result.callId)) {
        const content = this.resolveToolResult(result);
        messages.push({ role: 'tool', content, toolCallId: result.callId });
        await this.persistMessage(
          { role: 'tool', content, toolCallId: result.callId },
          { ctx: requestContext, messages, session, trace, toolApprovalState, signal, controller }
        );
      }
    }

    const context: TurnContext = { ctx: requestContext, messages, session, trace, toolApprovalState, signal, controller };

    if (checkpoint.pauseInfo) {
      // 路径 A：审批恢复
      await this.applyPauseInfoRecovery(checkpoint.pauseInfo, approvalDecisions || [], context);
      // 清除 pauseInfo
      await this.checkpointStore.save(turn.id, thread.id, { pauseInfo: null });
    } else if (checkpoint.pendingToolCall) {
      // 路径 B：工具重试
      await this.resolvePendingTool(checkpoint.pendingToolCall, checkpoint, messages, context);
    }
    // 路径 C：pendingToolCall == null → 直接继续

    messages.push(userMessage);
    await this.persistMessage(userMessage, context);
    await this.agent.thread.updateTurn(turn.id, { status: 'running' });
    return this.startTurnLoop(checkpoint.stepIndex, context, turnSpan, usage);
  }

  // 无 checkpoint → 降级到现有 heal 模式
  return this.legacyHealResume({ thread, turn, userMessage, signal, controller, options, usage, messages, trace, turnSpan, requestContext });
}
```

- [ ] **Step 2: 新增 resolvePendingTool 方法**

在 `applyPauseInfoRecovery` 方法之后添加：

```typescript
/**
 * 路径 B：重试 pending 工具。
 * 执行前检查消息链，若已有 tool_result 则跳过（并发恢复保护）。
 */
private async resolvePendingTool(
  pending: { id: string; name: string },
  checkpoint: Checkpoint,
  messages: ModelMessage[],
  context: TurnContext,
): Promise<void> {
  const turnId = context.session.turn.id;
  const threadId = context.session.thread.id;

  // 检查消息链中是否已有此 toolCall 的 tool_result（并发保护）
  const alreadyResolved = messages.some(
    m => m.role === 'tool' && m.toolCallId === pending.id
  );

  if (alreadyResolved) {
    // 跳过执行，从消息链提取已有结果并更新 checkpoint
    const existingResult: ToolResult = {
      callId: pending.id,
      name: pending.name,
      status: 'success',
      output: messages.find(m => m.role === 'tool' && m.toolCallId === pending.id)?.content ?? null,
    };
    await this.checkpointStore.save(turnId, threadId, {
      completedToolCallIds: [...checkpoint.completedToolCallIds, pending.id],
      completedToolResults: [...checkpoint.completedToolResults, existingResult],
      pendingToolCall: null,
    });
    return;
  }

  // 执行工具并持久化（pending 中已存完整 args，直接构造 ToolCall 即可）
  await this.executeToolCalls(
    [{ id: pending.id, name: pending.name, args: pending.args }],
    context,
  );
  // executeToolCalls 内部已持久化消息和更新 checkpoint（tool-done）
}
```

- [ ] **Step 3: 新增 legacyHealResume 方法**

在 `resolvePendingTool` 之后添加，将现有的 resumeTurn 中 heal 分支的逻辑封装为独立方法：

```typescript
/**
 * 降级恢复路径：使用现有的 healTurnMessages + applyPauseInfoRecovery 逻辑。
 * 当没有 checkpoint 或 checkpoint 校验失败时使用。
 */
private async legacyHealResume(params: {
  thread: Thread;
  turn: Turn;
  userMessage: ModelMessage;
  signal: AbortSignal;
  controller: ReadableStreamDefaultController<ModelStreamChunk>;
  options?: RunOptions;
  usage: UsageMetrics;
  messages: ModelMessage[];
  trace: TurnTrace;
  turnSpan: Span;
  requestContext: ModelRequestContext;
}): Promise<TurnResult> {
  const { thread, turn, userMessage, signal, controller, options, usage, messages, trace, turnSpan, requestContext } = params;
  const { approvalDecisions } = options || {};

  const toolApprovalState = new Map<string, boolean>();
  const context: TurnContext = { ctx: requestContext, messages, session: { thread, turn }, trace, toolApprovalState, signal, controller };

  // 原有 heal 逻辑：pauseInfo from turn.metadata（兼容旧数据）
  const pauseInfo = turn.metadata?.pauseInfo as PauseInfo | undefined;
  let startStep = turn.steps;

  if (pauseInfo) {
    await this.applyPauseInfoRecovery(pauseInfo, approvalDecisions || [], context);
    startStep = pauseInfo.pausedAtStep + 1;
  } else {
    const healResult = await this.healTurnMessages(messages, context, thread, turn, startStep, usage);
    if (healResult) return healResult;
  }

  messages.push(userMessage);
  await this.persistMessage(userMessage, context);
  await this.agent.thread.updateTurn(turn.id, { status: 'running' });
  return this.startTurnLoop(startStep, context, turnSpan, usage);
}
```

需要添加 `Span` 的 import：

```typescript
import { Span } from "../observable/types.js";
```

这个 import 已存在于 L17。

- [ ] **Step 4: 修改 healTurnMessages 中的 pauseInfo 存储**

修改 `healTurnMessages` 中 L321，将 pauseInfo 写入 checkpoint 而非 turn.metadata：

```typescript
if (pausedCalls.length > 0) {
  const newPauseInfo: PauseInfo = {
    reason: 'tool-approval',
    pendingToolCalls: pausedCalls,
    autoApprovedCalls: approvedCalls,
    autoDeniedResults: deniedResults,
    pausedAtStep: startStep,
    messageCount: messages.length,
  };

  // 写入 checkpoint 而非 turn.metadata
  await this.checkpointStore.save(turn.id, thread.id, {
    pauseInfo: newPauseInfo,
    stepIndex: startStep,
    messageCount: messages.length,
    toolApprovalState: Object.fromEntries(context.toolApprovalState),
  });
  await this.agent.thread.updateTurn(turn.id, { status: 'paused', steps: startStep });

  return {
    status: 'paused', steps: startStep, usage, messages, thread, turn,
  };
}
```

- [ ] **Step 5: 验证编译通过**

```bash
pnpm --filter @vico/agent exec tsc --noEmit 2>&1 | grep "agent-loop.ts" | grep -v "not exported" | head -20
```

Expected: no new errors

- [ ] **Step 6: 验证现有测试仍然通过**

```bash
pnpm --filter @vico/agent exec vitest run __tests__/agent-loop.test.ts 2>&1
```

- [ ] **Step 7: Commit**

```bash
git add packages/agent/src/agent-loop/agent-loop.ts
git commit -m "feat: refactor resumeTurn with three checkpoint-based recovery paths"
```

---

### Task 8: Checkpoint 集成测试

**Files:**
- Create: `packages/agent/__tests__/checkpoint.test.ts`
- Create: `packages/agent/__tests__/agent-loop-checkpoint.test.ts`

**Interfaces:**
- Consumes: `InMemoryCheckpointStore`, `Checkpoint`, `AgentLoop`, mock model/tools from existing tests

- [ ] **Step 1: 编写 checkpoint 单元测试**

```typescript
// checkpoint.test.ts — CheckpointStore unit tests
import { describe, expect, it } from 'vitest';
import { InMemoryCheckpointStore } from '../src/agent-loop/checkpoint-store.js';

describe('InMemoryCheckpointStore', () => {
  it('saves and retrieves a checkpoint', async () => {
    const store = new InMemoryCheckpointStore();
    const ckpt = await store.save('turn-1', 'thread-1', {
      stepIndex: 3,
      toolApprovalState: { 'read_file': true },
    });

    expect(ckpt.turnId).toBe('turn-1');
    expect(ckpt.stepIndex).toBe(3);
    expect(ckpt.toolApprovalState).toEqual({ 'read_file': true });
  });

  it('upserts on same turnId', async () => {
    const store = new InMemoryCheckpointStore();
    await store.save('turn-1', 'thread-1', { stepIndex: 1 });
    const ckpt = await store.save('turn-1', 'thread-1', { stepIndex: 5 });

    expect(ckpt.stepIndex).toBe(5);
    // 验证单行：listByThread 只返回一条
    const list = await store.listByThread('thread-1');
    expect(list).toHaveLength(1);
  });

  it('deletes checkpoint by turn', async () => {
    const store = new InMemoryCheckpointStore();
    await store.save('turn-1', 'thread-1', { stepIndex: 1 });
    await store.deleteByTurn('turn-1');
    expect(await store.getByTurn('turn-1')).toBeUndefined();
  });

  it('purges expired checkpoints', async () => {
    const store = new InMemoryCheckpointStore();
    // 创建一个"已过期"的 checkpoint（直接操作内部 store 设置旧时间戳）
    const ckpt = await store.save('turn-1', 'thread-1', { pauseInfo: { reason: 'tool-approval', pendingToolCalls: [], pausedAtStep: 0, messageCount: 0 } });
    // 用极短的 TTL（1ms）来触发过期
    await new Promise(r => setTimeout(r, 5));
    const expired = await store.purgeExpired(1);
    expect(expired).toContain('turn-1');
    expect(await store.getByTurn('turn-1')).toBeUndefined();
  });

  it('preserves completedToolCallIds across updates', async () => {
    const store = new InMemoryCheckpointStore();
    await store.save('turn-1', 'thread-1', {
      completedToolCallIds: ['call-1'],
      completedToolResults: [{ callId: 'call-1', name: 't1', status: 'success', output: 'ok' }],
    });
    await store.save('turn-1', 'thread-1', {
      completedToolCallIds: ['call-1', 'call-2'],
      completedToolResults: [
        { callId: 'call-1', name: 't1', status: 'success', output: 'ok' },
        { callId: 'call-2', name: 't2', status: 'success', output: 'ok2' },
      ],
    });
    const ckpt = await store.getByTurn('turn-1');
    expect(ckpt!.completedToolCallIds).toEqual(['call-1', 'call-2']);
    expect(ckpt!.completedToolResults).toHaveLength(2);
  });
});
```

- [ ] **Step 2: 运行单元测试**

```bash
pnpm --filter @vico/agent exec vitest run __tests__/checkpoint.test.ts 2>&1
```

Expected: all pass

- [ ] **Step 3: 编写 AgentLoop + checkpoint 集成测试**

```typescript
// agent-loop-checkpoint.test.ts — AgentLoop checkpoint integration tests
import { describe, expect, it, vi } from 'vitest';
import type { LanguageModelV3, LanguageModelV3StreamResult } from '@ai-sdk/provider';
import { AgentLoop } from '../src/agent-loop/agent-loop.js';
import { Agent } from '../src/agent-loop/agent.js';
import type { TurnEvent } from '../src/agent-loop/types.js';
import { MittEventRecorder } from '../src/events/event-recorder.js';
import { TurnTracer } from '../src/observable/turn-tracer.js';
import { SystemPromptProcessor } from '../src/agent-loop/context-processors/system-prompt-processor.js';
import { MemoryStore } from '../src/memory/memory-store.js';
import { InMemoryThreadStore } from '../src/thread/memory-thread-store.js';
import { collectTurnResult } from '../src/agent-loop/utils.js';
import { InMemoryCheckpointStore } from '../src/agent-loop/checkpoint-store.js';

function createMockModel(chunks: any[]): LanguageModelV3 {
  return {
    specificationVersion: 'v3',
    provider: 'mock',
    modelId: 'mock-model',
    supportedUrls: {},
    doGenerate: vi.fn().mockRejectedValue(new Error('not implemented')),
    doStream: vi.fn().mockResolvedValue({
      stream: new ReadableStream({
        start(controller) {
          for (const chunk of chunks) controller.enqueue(chunk);
          controller.close();
        },
      }),
    } satisfies LanguageModelV3StreamResult),
  };
}

const mockToolBroker = {
  list: () => [],
  findTool: (_name: string) => ({ policy: 'auto', kind: 'readonly' }),
  execute: async (call: any) => ({ callId: call.id, name: call.name, status: 'success' as const, output: 'ok' }),
  executeBatch: async (calls: any[]) =>
    calls.map((c: any) => ({ callId: c.id, name: c.name, status: 'success' as const, output: 'ok' })),
};

describe('AgentLoop with checkpoint', () => {
  function makeAgent(chunks: any[]) {
    const events = new MittEventRecorder<TurnEvent>();
    return new Agent({
      id: '00000000-0000-4000-8000-000000000001',
      name: 'test-agent',
      systemPrompt: 'You are helpful.',
      model: createMockModel(chunks),
      temperature: 0.7,
      maxTokens: 4096,
      maxSteps: 3,
      memory: new MemoryStore(),
      thread: new InMemoryThreadStore(),
      events,
      tracer: new TurnTracer(events, []),
    }) as any;
  }

  it('creates checkpoint during tool execution', async () => {
    const agent = makeAgent([
      { type: 'tool-call', toolCallId: 'call-1', toolName: 'search', input: JSON.stringify({}) },
      { type: 'finish', finishReason: { unified: 'tool-calls', raw: 'tool_calls' }, usage: { inputTokens: { total: 10 }, outputTokens: { total: 5 } } },
    ]);

    const checkpointStore = new InMemoryCheckpointStore();
    const loop = new AgentLoop({
      agent,
      toolBroker: mockToolBroker as any,
      processors: [new SystemPromptProcessor()],
      checkpointStore,
    });

    const output = loop.run('thread-1', { role: 'user', content: 'search' });
    await output.result.catch(() => {});

    const ckpt = await checkpointStore.getByTurn(
      (await agent.thread.getLatestTurn('thread-1'))!.id
    );
    expect(ckpt).toBeDefined();
    // tool-done checkpoint：completedToolCallIds 应包含 call-1
    expect(ckpt!.completedToolCallIds).toContain('call-1');
    expect(ckpt!.pendingToolCall).toBeNull();
  });

  it('removes checkpoint on turn completed', async () => {
    const agent = makeAgent([
      { type: 'text-start', id: '1' },
      { type: 'text-delta', id: '1', delta: 'Hello!' },
      { type: 'text-end', id: '1' },
      { type: 'finish', finishReason: { unified: 'stop', raw: 'stop' }, usage: { inputTokens: { total: 10 }, outputTokens: { total: 5 } } },
    ]);

    const checkpointStore = new InMemoryCheckpointStore();
    const loop = new AgentLoop({
      agent,
      toolBroker: mockToolBroker as any,
      processors: [new SystemPromptProcessor()],
      checkpointStore,
    });

    const result = await collectTurnResult(loop.run('thread-1', { role: 'user', content: 'hi' }));
    expect(result.status).toBe('completed');

    const ckpt = await checkpointStore.getByTurn(result.turn.id);
    expect(ckpt).toBeUndefined();
  });
});
```

- [ ] **Step 4: 运行集成测试**

```bash
pnpm --filter @vico/agent exec vitest run __tests__/agent-loop-checkpoint.test.ts 2>&1
```

Expected: all pass

- [ ] **Step 5: Commit**

```bash
git add packages/agent/__tests__/checkpoint.test.ts packages/agent/__tests__/agent-loop-checkpoint.test.ts
git commit -m "test: add checkpoint unit and integration tests"
```

---

### Task 9: 添加 checkpoints 表到 LibSQL schema

**Files:**
- Modify: `packages/libsql-adapter/src/schema.ts`

- [ ] **Step 1: 读取现有 schema 并添加新表**

在 `packages/libsql-adapter/src/schema.ts` 中添加 checkpoints 表定义：

```typescript
// checkpoints — turn 执行状态检查点，用于崩溃恢复和审批恢复
export const checkpoints = sqliteTable('checkpoints', {
  id: text('id').primaryKey(),
  turnId: text('turn_id').notNull().unique(),
  threadId: text('thread_id').notNull(),
  version: integer('version').notNull().default(1),
  stepIndex: integer('step_index').notNull().default(0),
  paused: integer('paused').notNull().default(0),
  pendingTool: text('pending_tool'),
  snapshot: text('snapshot').notNull(),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

// 索引
export const checkpointsThreadIdIdx = index('idx_checkpoints_thread_id').on(checkpoints.threadId);
export const checkpointsCreatedAtIdx = index('idx_checkpoints_created_at').on(checkpoints.createdAt);
```

- [ ] **Step 2: 验证编译**

```bash
pnpm --filter @vico/libsql-adapter exec tsc --noEmit 2>&1 | grep "schema" | head -10
```

- [ ] **Step 3: Commit**

```bash
git add packages/libsql-adapter/src/schema.ts
git commit -m "feat: add checkpoints table to libsql schema"
```

---

### Task 10: 创建 LibSQL CheckpointStore 实现

**Files:**
- Create: `packages/libsql-adapter/src/checkpoint-store.ts`

- [ ] **Step 1: 创建实现文件**

```typescript
// @vico/libsql-adapter — LibSQL CheckpointStore implementation
import { eq, lt } from 'drizzle-orm';
import type { Checkpoint, CheckpointStore } from '@vico/agent';
import { CHECKPOINT_CURRENT_VERSION, checkpointMigrations } from '@vico/agent';
import { checkpoints } from './schema.js';
import type { LibSQLDatabase } from './types.js'; // 或实际导出名

export class LibSqlCheckpointStore implements CheckpointStore {
  constructor(private db: LibSQLDatabase) {}

  async save(turnId: string, threadId: string, patch: Partial<Checkpoint>): Promise<Checkpoint> {
    const existing = await this.getByTurn(turnId);
    const now = Date.now();

    if (existing) {
      const merged: Checkpoint = {
        ...existing,
        ...patch,
        version: CHECKPOINT_CURRENT_VERSION,
        updatedAt: now,
        completedToolCallIds: patch.completedToolCallIds ?? existing.completedToolCallIds,
        completedToolResults: patch.completedToolResults ?? existing.completedToolResults,
      };

      const row = this.toRow(merged);
      await this.db.update(checkpoints)
        .set(row)
        .where(eq(checkpoints.turnId, turnId))
        .run();
      return merged;
    }

    const created: Checkpoint = {
      id: `ckpt-${turnId}`,
      turnId,
      threadId,
      version: CHECKPOINT_CURRENT_VERSION,
      stepIndex: 0,
      toolApprovalState: {},
      pauseInfo: null,
      messageCount: 0,
      lastMessageId: null,
      completedToolCallIds: [],
      completedToolResults: [],
      pendingToolCall: null,
      createdAt: now,
      updatedAt: now,
      ...patch,
    };

    const row = this.toRow(created);
    await this.db.insert(checkpoints).values(row).run();
    return created;
  }

  async getByTurn(turnId: string): Promise<Checkpoint | undefined> {
    const row = await this.db.select().from(checkpoints).where(eq(checkpoints.turnId, turnId)).get();
    if (!row) return undefined;

    let snapshot = JSON.parse(row.snapshot) as Record<string, unknown>;
    while ((snapshot.version as number) < CHECKPOINT_CURRENT_VERSION) {
      const migrateFn = checkpointMigrations[snapshot.version as number];
      if (!migrateFn) break;
      snapshot = migrateFn(snapshot);
    }
    return snapshot as unknown as Checkpoint;
  }

  async listByThread(threadId: string): Promise<Checkpoint[]> {
    const rows = await this.db.select().from(checkpoints).where(eq(checkpoints.threadId, threadId)).all();
    return rows.map(r => {
      let snapshot = JSON.parse(r.snapshot) as Record<string, unknown>;
      while ((snapshot.version as number) < CHECKPOINT_CURRENT_VERSION) {
        const migrateFn = checkpointMigrations[snapshot.version as number];
        if (!migrateFn) break;
        snapshot = migrateFn(snapshot);
      }
      return snapshot as unknown as Checkpoint;
    });
  }

  async deleteByTurn(turnId: string): Promise<void> {
    await this.db.delete(checkpoints).where(eq(checkpoints.turnId, turnId)).run();
  }

  async purgeExpired(ttlMs: number): Promise<string[]> {
    const cutoff = Date.now() - ttlMs;
    const expired = await this.db
      .select({ turnId: checkpoints.turnId, paused: checkpoints.paused })
      .from(checkpoints)
      .where(lt(checkpoints.createdAt, cutoff))
      .all();

    await this.db.delete(checkpoints).where(lt(checkpoints.createdAt, cutoff)).run();

    return expired.filter(r => r.paused === 1).map(r => r.turnId);
  }

  private toRow(ckpt: Checkpoint) {
    return {
      id: ckpt.id,
      turnId: ckpt.turnId,
      threadId: ckpt.threadId,
      version: ckpt.version,
      stepIndex: ckpt.stepIndex,
      paused: ckpt.pauseInfo !== null ? 1 : 0,
      pendingTool: ckpt.pendingToolCall ? JSON.stringify(ckpt.pendingToolCall) : null,
      snapshot: JSON.stringify(ckpt),
      createdAt: ckpt.createdAt,
      updatedAt: ckpt.updatedAt,
    };
  }
}
```

- [ ] **Step 2: 验证编译**

需要先检查 libsql-adapter 中 database 的导出类型名：

```bash
grep -r "export.*Database\|export type.*Database\|export.*LibSQLDB" packages/libsql-adapter/src/ --include="*.ts" -l
```

根据实际导出调整 import。

- [ ] **Step 3: 验证编译通过**

```bash
pnpm --filter @vico/libsql-adapter exec tsc --noEmit 2>&1 | grep "checkpoint-store" | head -10
```

- [ ] **Step 4: Commit**

```bash
git add packages/libsql-adapter/src/checkpoint-store.ts
git commit -m "feat: add LibSqlCheckpointStore implementation"
```

---

### Task 11: 更新 exports

**Files:**
- Modify: `packages/agent/src/index.ts`

- [ ] **Step 1: 添加 checkpoint 相关 export**

```typescript
// Checkpoint
export { CHECKPOINT_CURRENT_VERSION, checkpointMigrations, DEFAULT_CHECKPOINT_TTL } from './agent-loop/checkpoint.js';
export type { Checkpoint, CheckpointStore, PauseInfo } from './agent-loop/checkpoint.js';
export { InMemoryCheckpointStore } from './agent-loop/checkpoint-store.js';
```

- [ ] **Step 2: 验证编译**

```bash
pnpm --filter @vico/agent exec tsc --noEmit 2>&1 | grep "index.ts" | head -10
```

- [ ] **Step 3: Commit**

```bash
git add packages/agent/src/index.ts
git commit -m "feat: export checkpoint types and store from agent package"
```

---

### Task 12: 端到端验证

- [ ] **Step 1: 运行所有 agent 测试**

```bash
pnpm --filter @vico/agent exec vitest run 2>&1
```

Expected: all existing tests pass + new checkpoint tests pass

- [ ] **Step 2: 运行全局类型检查**

```bash
pnpm exec tsc --noEmit 2>&1 | head -30
```

Expected: no new errors introduced by the checkpoint changes (pre-existing errors acceptable)

- [ ] **Step 3: 如有失败，修复并重新验证**

- [ ] **Step 4: Final commit** (仅当有修复时)

```bash
git add -A
git commit -m "fix: resolve checkpoint integration issues found in e2e verification"
```
