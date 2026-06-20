# @vico/agent Phase 4 — 审批交互与子 Agent 委托

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 实现审批流程（SSE 审批事件 + awaitApproval 机制）和子 Agent 委托（ChildAgentExecutor），完善 AgentLoop 的审批门控。

**Architecture:** 审批流通过 `approval_request` SSE 事件通知外部，外部通过 `awaitApproval` 回调返回决策。子 Agent 委托通过 `delegate` tool kind 并行调用其他 Agent。

**Tech Stack:** TypeScript 5.6+，无新增依赖

**注意：** Phase 1 已完成 Hook 系统和可观测性，Phase 4 聚焦审批 + 委托。

## Global Constraints

- 所有新增代码在 `packages/agent/src/` 下
- ESM 模块，导入带 `.js` 扩展名
- 不依赖 `@vico/server`，不依赖 Mastra

---

### Task 1: ApprovalGate

**Files:**
- Create: `packages/agent/src/agent-loop/approval-gate.ts`

- [ ] **Step 1: Write approval-gate.ts**

```typescript
// src/agent-loop/approval-gate.ts
import type { ToolCall } from '../contracts/tool.js';
import type { ApprovalDecision } from '../tool/tool-host.js';
import type { EventRecorder } from '../observable/event-recorder.js';

/** 外部审批处理函数 — 返回决策或 timeout 后默认拒绝 */
export type ApprovalHandler = (call: ToolCall) => Promise<ApprovalDecision>;

/** 审批门控 — 管理需要用户审批的工具调用 */
export class ApprovalGate {
  private handler: ApprovalHandler;
  private events: EventRecorder;
  private defaultTimeout: number;

  constructor(handler: ApprovalHandler, events: EventRecorder, defaultTimeout = 60_000) {
    this.handler = handler;
    this.events = events;
    this.defaultTimeout = defaultTimeout;
  }

  /** 请求审批，带超时回退 */
  async requestApproval(call: ToolCall, timeoutMs?: number): Promise<ApprovalDecision> {
    // 发射审批请求事件
    this.events.emit({
      type: 'approval_request',
      callId: call.id,
      name: call.name,
      args: call.args,
    });

    const timeout = timeoutMs ?? this.defaultTimeout;

    try {
      const decision = await Promise.race([
        this.handler(call),
        new Promise<ApprovalDecision>((resolve) =>
          setTimeout(() => resolve({ approved: false, reason: 'Approval timeout' }), timeout),
        ),
      ]);
      return decision;
    } catch {
      return { approved: false, reason: 'Approval handler error' };
    }
  }
}
```

- [ ] **Step 2: Verify and commit**

```bash
cd packages/agent && npx tsc --noEmit
git add packages/agent/src/agent-loop/approval-gate.ts
git commit -m "feat(agent): implement ApprovalGate with timeout and SSE events"
```

---

### Task 2: ChildAgentExecutor

**Files:**
- Create: `packages/agent/src/tool/child-agent-executor.ts`

- [ ] **Step 1: Write child-agent-executor.ts**

```typescript
// src/tool/child-agent-executor.ts
import type { ToolSpec, ToolCall, ToolResult } from '../contracts/tool.js';
import type { ToolExecutionContext } from './tool-host.js';
import type { AgentLoop } from '../agent-loop/agent-loop.js';
import type { ModelMessage } from '../model/model-client.js';

/** 子 Agent 委托策略 */
export type DelegateStrategy = 'readonly' | 'inherit';

export interface ChildAgentRef {
  /** 子 Agent 标识 */
  agentId: string;
  /** 子 Agent 的 AgentLoop 实例 */
  loop: AgentLoop;
}

/** 子 Agent 委托执行器 */
export class ChildAgentExecutor {
  private agents: Map<string, ChildAgentRef> = new Map();

  register(agentId: string, loop: AgentLoop): void {
    this.agents.set(agentId, loop);
  }

  unregister(agentId: string): void {
    this.agents.delete(agentId);
  }

  /** 创建委托工具规格 */
  createDelegateToolSpec(agentId: string, agentName: string): ToolSpec {
    return {
      name: `delegate_${agentId}`,
      description: `Delegate a task to the "${agentName}" agent. Use this when the user needs ${agentName}-related capabilities.`,
      inputSchema: {
        type: 'object',
        properties: {
          task: { type: 'string', description: 'The task to delegate' },
          context: { type: 'string', description: 'Additional context' },
        },
        required: ['task'],
      },
      policy: 'auto',
      kind: 'delegate',
    };
  }

  /** 执行委托 */
  async execute(call: ToolCall, ctx: ToolExecutionContext): Promise<ToolResult> {
    const agentId = (call.args as any).agentId ?? call.name.replace('delegate_', '');
    const ref = this.agents.get(agentId);

    if (!ref) {
      return { callId: call.id, name: call.name, status: 'error', error: `Agent ${agentId} not found` };
    }

    const task = (call.args as any).task as string;
    const context = (call.args as any).context as string | undefined;

    const userMessage: ModelMessage = {
      role: 'user',
      content: context ? `Task: ${task}\n\nContext: ${context}` : task,
    };

    try {
      const result = await ref.loop.runTurn(
        `delegate-${agentId}-${Date.now()}`,
        [],
        userMessage,
        ctx.signal,
      );

      const output = result.messages
        .filter((m) => m.role === 'assistant')
        .map((m) => m.content)
        .join('\n');

      return { callId: call.id, name: call.name, status: 'success', output };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { callId: call.id, name: call.name, status: 'error', error: message };
    }
  }
}
```

- [ ] **Step 2: Verify and commit**

```bash
cd packages/agent && npx tsc --noEmit
git add packages/agent/src/tool/child-agent-executor.ts
git commit -m "feat(agent): implement ChildAgentExecutor for sub-agent delegation"
```

---

### Task 3: Wire ApprovalGate into AgentLoop

**Files:**
- Modify: `packages/agent/src/agent-loop/agent-loop.ts` — add `approvalGate` to options, wire into tool dispatch

- [ ] **Step 1: Update AgentLoopOptions and integration**

In `AgentLoopOptions` add: `approvalGate?: ApprovalGate`

In `dispatchTools`:
```typescript
// Before executing tool calls, check approval for non-auto policies
// The ApprovalGate is called by ToolHost.execute() via ctx.awaitApproval
// For Phase 4, we wire the ApprovalGate as the default awaitApproval handler
```

In the `ToolExecutionContext` construction within `dispatchTools`:
```typescript
const context: ToolExecutionContext = {
  ...baseCtx,
  awaitApproval: async (call: ToolCall) => {
    if (this.approvalGate) {
      return this.approvalGate.requestApproval(call);
    }
    return { approved: true };
  },
};
```

- [ ] **Step 2: Update index.ts**

```typescript
export { ApprovalGate, type ApprovalHandler } from './agent-loop/approval-gate.js';
export { ChildAgentExecutor, type ChildAgentRef, type DelegateStrategy } from './tool/child-agent-executor.js';
```

- [ ] **Step 3: Verify and commit**

```bash
cd packages/agent && npx tsc --noEmit
git add packages/agent/src/agent-loop/agent-loop.ts packages/agent/src/index.ts
git commit -m "feat(agent): wire ApprovalGate and ChildAgentExecutor into AgentLoop"
```

---

### Task 4: Tests

**Files:**
- Create: `packages/agent/src/__tests__/approval-gate.test.ts`
- Create: `packages/agent/src/__tests__/child-agent-executor.test.ts`

- [ ] **Step 1: Write tests**

```typescript
// approval-gate.test.ts
import { describe, it, expect, vi } from 'vitest';
import { ApprovalGate } from '../agent-loop/approval-gate.js';
import { MittEventRecorder } from '../observable/event-recorder.js';

describe('ApprovalGate', () => {
  it('calls handler and returns decision', async () => {
    const events = new MittEventRecorder();
    const handler = vi.fn().mockResolvedValue({ approved: true });
    const gate = new ApprovalGate(handler, events);

    const decision = await gate.requestApproval({ id: '1', name: 'test', args: {} });
    expect(decision.approved).toBe(true);
    expect(handler).toHaveBeenCalled();
  });

  it('emits approval_request event', async () => {
    const events = new MittEventRecorder();
    const caught: any[] = [];
    events.on('approval_request', (e) => caught.push(e));

    const gate = new ApprovalGate(async () => ({ approved: true }), events);
    await gate.requestApproval({ id: '2', name: 'delete', args: { file: 'x' } });

    expect(caught).toHaveLength(1);
    expect(caught[0].name).toBe('delete');
  });

  it('times out after specified duration', async () => {
    const events = new MittEventRecorder();
    const gate = new ApprovalGate(
      async () => new Promise(() => {}), // never resolves
      events,
      50, // short timeout
    );
    const decision = await gate.requestApproval({ id: '3', name: 'slow', args: {} });
    expect(decision.approved).toBe(false);
    expect(decision.reason).toContain('timeout');
  });
});
```

```typescript
// child-agent-executor.test.ts
import { describe, it, expect } from 'vitest';
import { ChildAgentExecutor } from '../tool/child-agent-executor.js';

describe('ChildAgentExecutor', () => {
  it('creates delegate tool spec', () => {
    const executor = new ChildAgentExecutor();
    const spec = executor.createDelegateToolSpec('agent-1', 'Code Reviewer');
    expect(spec.name).toBe('delegate_agent-1');
    expect(spec.kind).toBe('delegate');
    expect(spec.description).toContain('Code Reviewer');
  });

  it('returns error for unknown agent', async () => {
    const executor = new ChildAgentExecutor();
    const result = await executor.execute(
      { id: '1', name: 'delegate_unknown', args: {} },
      { tenantId: 't1', userId: 'u1', agentId: 'a1', threadId: 'th1', workspace: '/', hooks: [], signal: new AbortController().signal, awaitApproval: async () => ({ approved: true }) },
    );
    expect(result.status).toBe('error');
  });
});
```

- [ ] **Step 2: Run tests and commit**

```bash
cd packages/agent && npx vitest run
git add packages/agent/src/__tests__/
git commit -m "test(agent): add tests for approval gate and child agent executor"
```
