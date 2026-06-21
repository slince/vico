# @vico/agent Phase 3 — 记忆系统与上下文管理

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 实现 MemoryStore 端口的三层记忆系统（STM/LTM/RAG）、ContextCompactor 上下文压缩、TokenEconomy，集成进 AgentLoop。

**Architecture:** STM 用内存 Map 实现 FIFO 滑动窗口；LTM 和 RAG 提供内存适配器（Phase 5 替换为 DB 实现）；ContextCompactor 用启发式阈值 + LLM 摘要压缩历史；TokenEconomy 管理累计用量预算。

**Tech Stack:** TypeScript 5.6+，无新增依赖

## Global Constraints

- 所有新增代码在 `packages/agent/src/` 下
- ESM 模块，导入带 `.js` 扩展名
- 零循环依赖
- 不依赖 `@vico/server`，不依赖 Mastra
- MemoryStore 已在 Phase 1 定义接口，Phase 3 提供实现

---

### Task 1: ShortTermMemory Implementation

**Files:**
- Create: `packages/agent/src/memory/short-term-memory.ts`

- [ ] **Step 1: Write short-term-memory.ts**

```typescript
// src/memory/short-term-memory.ts
import type { ModelMessage } from '../model/model-client.js';

/** 短期记忆 — 基于 Map 的 FIFO 滑动窗口 */
export class ShortTermMemory {
  private threads: Map<string, ModelMessage[]> = new Map();

  push(threadId: string, message: ModelMessage): void {
    const msgs = this.threads.get(threadId) ?? [];
    msgs.push(message);
    this.threads.set(threadId, msgs);
  }

  get(threadId: string, window: number): ModelMessage[] {
    const msgs = this.threads.get(threadId) ?? [];
    if (msgs.length <= window) return [...msgs];
    return msgs.slice(msgs.length - window);
  }

  clear(threadId: string): void {
    this.threads.delete(threadId);
  }

  clearAll(): void {
    this.threads.clear();
  }
}
```

- [ ] **Step 2: Verify and commit**

```bash
cd vico/agent && npx tsc --noEmit
git add vico/agent/src/memory/short-term-memory.ts
git commit -m "feat(agent): implement ShortTermMemory with FIFO sliding window"
```

---

### Task 2: InMemoryMemoryStore Adapter

**Files:**
- Create: `packages/agent/src/memory/memory-store-impl.ts`

- [ ] **Step 1: Write memory-store-impl.ts**

```typescript
// src/memory/memory-store-impl.ts
import type { MemoryStore } from './memory-store.js';
import type { ModelMessage } from '../model/model-client.js';
import type { MemoryRecord } from '../contracts/memory.js';
import type { RagChunk } from '../prompt/assembler.js';
import { ShortTermMemory } from './short-term-memory.js';

/** Phase 3 内存版 MemoryStore — STM 完整实现，LTM/RAG 为存根（Phase 5 接 DB） */
export class InMemoryMemoryStore implements MemoryStore {
  stm: {
    push(threadId: string, message: ModelMessage): void;
    get(threadId: string, window: number): ModelMessage[];
  };

  ltm: {
    search(query: string, tenantId: string, limit?: number): Promise<MemoryRecord[]>;
    create(record: MemoryRecord): Promise<void>;
    update(id: string, patch: Partial<MemoryRecord>): Promise<void>;
    delete(id: string): Promise<void>;
  };

  rag: {
    search(query: string, knowledgeBaseId: string, limit?: number): Promise<RagChunk[]>;
  };

  constructor() {
    const shortTerm = new ShortTermMemory();
    const ltmRecords: MemoryRecord[] = [];

    this.stm = {
      push: (threadId, message) => shortTerm.push(threadId, message),
      get: (threadId, window) => shortTerm.get(threadId, window),
    };

    this.ltm = {
      search: async (query, tenantId, limit = 5) => {
        const q = query.toLowerCase();
        const filtered = ltmRecords
          .filter((r) => r.tenantId === tenantId && r.content.toLowerCase().includes(q))
          .slice(0, limit);
        return filtered;
      },
      create: async (record) => { ltmRecords.push(record); },
      update: async (id, patch) => {
        const idx = ltmRecords.findIndex((r) => r.id === id);
        if (idx !== -1) Object.assign(ltmRecords[idx], patch);
      },
      delete: async (id) => {
        const idx = ltmRecords.findIndex((r) => r.id === id);
        if (idx !== -1) ltmRecords.splice(idx, 1);
      },
    };

    const ragChunks: Map<string, RagChunk[]> = new Map();

    this.rag = {
      search: async (query, knowledgeBaseId, limit = 5) => {
        const chunks = ragChunks.get(knowledgeBaseId) ?? [];
        const q = query.toLowerCase();
        return chunks.filter((c) => c.content.toLowerCase().includes(q)).slice(0, limit);
      },
    };
  }
}
```

- [ ] **Step 2: Verify and commit**

```bash
cd vico/agent && npx tsc --noEmit
git add vico/agent/src/memory/memory-store-impl.ts
git commit -m "feat(agent): implement InMemoryMemoryStore with STM/LTM/RAG stubs"
```

---

### Task 3: ContextCompactor Implementation

**Files:**
- Modify: `packages/agent/src/agent-loop/context-compactor.ts` — replace interface with implementation

- [ ] **Step 1: Write ContextCompactorImpl**

Read existing file, replace with:

```typescript
// src/agent-loop/context-compactor.ts
import type { ModelMessage, ModelClient } from '../model/model-client.js';

export interface ContextCompactor {
  compactIfNeeded(
    items: ModelMessage[],
    model: ModelClient,
    signal: AbortSignal,
  ): Promise<{ compacted: ModelMessage[]; wasCompacted: boolean; removedTokens: number }>;
}

/** 简单的 Token 估算（4 字符 ≈ 1 token） */
function estimateTokens(messages: ModelMessage[]): number {
  let chars = 0;
  for (const m of messages) {
    chars += m.content.length;
    if (m.toolCalls) chars += JSON.stringify(m.toolCalls).length;
  }
  return Math.ceil(chars / 4);
}

/** 上下文压缩器 — 启发式阈值 + LLM 摘要 */
export class ContextCompactorImpl implements ContextCompactor {
  private softThreshold: number;
  private keepRecent: number;

  constructor(softThreshold = 8000, keepRecent = 6) {
    this.softThreshold = softThreshold;
    this.keepRecent = keepRecent;
  }

  async compactIfNeeded(
    items: ModelMessage[],
    model: ModelClient,
    signal: AbortSignal,
  ): Promise<{ compacted: ModelMessage[]; wasCompacted: boolean; removedTokens: number }> {
    const estimated = estimateTokens(items);
    if (estimated < this.softThreshold) {
      return { compacted: items, wasCompacted: false, removedTokens: 0 };
    }

    if (items.length <= this.keepRecent + 2) {
      return { compacted: items, wasCompacted: false, removedTokens: 0 };
    }

    const head = items.slice(0, -this.keepRecent);
    const tail = items.slice(-this.keepRecent);
    const headTokens = estimateTokens(head);

    let summaryContent: string;
    try {
      const request = {
        system: 'Summarize the following conversation concisely. Keep key decisions, facts, and action items.',
        messages: head,
        tools: [],
        abortSignal: signal,
      };
      let text = '';
      for await (const chunk of model.stream(request)) {
        if (chunk.type === 'text_delta') text += chunk.content;
      }
      summaryContent = text;
    } catch {
      // 模型摘要失败时回退到简单截断
      summaryContent = head.map((m) => `${m.role}: ${m.content.slice(0, 200)}`).join('\n');
    }

    const summaryMessage: ModelMessage = { role: 'system', content: `[Conversation summary]\n${summaryContent}` };
    return {
      compacted: [summaryMessage, ...tail],
      wasCompacted: true,
      removedTokens: headTokens - Math.ceil(summaryContent.length / 4),
    };
  }
}
```

- [ ] **Step 2: Verify and commit**

```bash
cd vico/agent && npx tsc --noEmit
git add vico/agent/src/agent-loop/context-compactor.ts
git commit -m "feat(agent): implement ContextCompactor with LLM summarization"
```

---

### Task 4: TokenEconomy Implementation

**Files:**
- Create: `packages/agent/src/agent-loop/token-economy.ts`

- [ ] **Step 1: Write token-economy.ts**

```typescript
// src/agent-loop/token-economy.ts

/** Token 经济管理 — 跟踪累计用量，按预算截断 */
export class TokenEconomy {
  private inputTokens = 0;
  private outputTokens = 0;
  private inputBudget: number;
  private outputBudget: number;
  /** 每个工具结果的最大长度 */
  private maxToolResultLength: number;

  constructor(inputBudget = 100_000, outputBudget = 20_000, maxToolResultLength = 4000) {
    this.inputBudget = inputBudget;
    this.outputBudget = outputBudget;
    this.maxToolResultLength = maxToolResultLength;
  }

  track(input: number, output: number): void {
    this.inputTokens += input;
    this.outputTokens += output;
  }

  /** 检查输入预算是否超限 */
  isInputExhausted(): boolean {
    return this.inputTokens >= this.inputBudget;
  }

  /** 检查输出预算是否超限 */
  isOutputExhausted(): boolean {
    return this.outputTokens >= this.outputBudget;
  }

  /** 截断工具输出 */
  truncateToolOutput(output: string): string {
    if (output.length <= this.maxToolResultLength) return output;
    return output.slice(0, this.maxToolResultLength) + '... [truncated]';
  }

  getUsage(): { input: number; output: number } {
    return { input: this.inputTokens, output: this.outputTokens };
  }

  reset(): void {
    this.inputTokens = 0;
    this.outputTokens = 0;
  }
}
```

- [ ] **Step 2: Verify and commit**

```bash
cd vico/agent && npx tsc --noEmit
git add vico/agent/src/agent-loop/token-economy.ts
git commit -m "feat(agent): implement TokenEconomy with budget tracking and truncation"
```

---

### Task 5: Integrate into AgentLoop

**Files:**
- Modify: `packages/agent/src/agent-loop/agent-loop.ts` — wire in ContextCompactor and TokenEconomy

- [ ] **Step 1: Update AgentLoopOptions and AgentLoopImpl**

Changes to `agent-loop.ts`:
1. Add `tokenEconomy` field to `AgentLoopOptions`
2. In `runTurn`: track token usage via tokenEconomy, check budget before each step, call compactor when needed
3. Truncate tool results via tokenEconomy

Minimal integration — add after model stream:

```typescript
// After collecting usage:
if (chunk.type === 'usage') {
  usage.input += chunk.input;
  usage.output += chunk.output;
  this.tokenEconomy.track(chunk.input, chunk.output); // NEW
}

// Before model step, check budget and compress:
if (this.tokenEconomy.isInputExhausted()) {
  this.events.emit({ type: 'error', message: 'Input token budget exhausted' });
  break;
}

// After tool results, truncate:
const truncatedOutput = this.tokenEconomy.truncateToolOutput(JSON.stringify(result.output));
```

- [ ] **Step 2: Update index.ts exports**

```typescript
export { ShortTermMemory } from './memory/short-term-memory.js';
export { InMemoryMemoryStore } from './memory/memory-store-impl.js';
export { ContextCompactorImpl } from './agent-loop/context-compactor.js';
export { TokenEconomy } from './agent-loop/token-economy.js';
```

- [ ] **Step 3: Verify and commit**

```bash
cd vico/agent && npx tsc --noEmit
git add vico/agent/src/agent-loop/agent-loop.ts vico/agent/src/index.ts
git commit -m "feat(agent): integrate memory, compactor, and token economy into AgentLoop"
```

---

### Task 6: Tests

**Files:**
- Create: `packages/agent/src/__tests__/short-term-memory.test.ts`
- Create: `packages/agent/src/__tests__/context-compactor.test.ts`
- Create: `packages/agent/src/__tests__/token-economy.test.ts`

- [ ] **Step 1: Write tests**

```typescript
// short-term-memory.test.ts
import { describe, it, expect } from 'vitest';
import { ShortTermMemory } from '../memory/short-term-memory.js';

describe('ShortTermMemory', () => {
  it('stores and retrieves messages', () => {
    const stm = new ShortTermMemory();
    stm.push('t1', { role: 'user', content: 'hi' });
    expect(stm.get('t1', 10)).toHaveLength(1);
  });

  it('enforces FIFO window', () => {
    const stm = new ShortTermMemory();
    for (let i = 0; i < 10; i++) stm.push('t1', { role: 'user', content: `msg${i}` });
    expect(stm.get('t1', 3)).toHaveLength(3);
    expect(stm.get('t1', 3)[2].content).toBe('msg9');
  });
});
```

```typescript
// context-compactor.test.ts
import { describe, it, expect } from 'vitest';
import { ContextCompactorImpl } from '../agent-loop/context-compactor.js';

describe('ContextCompactorImpl', () => {
  it('does not compact below threshold', async () => {
    const c = new ContextCompactorImpl(100000, 3);
    const msgs = [{ role: 'user' as const, content: 'short' }];
    const result = await c.compactIfNeeded(msgs, null as any, new AbortController().signal);
    expect(result.wasCompacted).toBe(false);
  });

  it('compacts when over threshold', async () => {
    const c = new ContextCompactorImpl(10, 3);
    const msgs = Array.from({ length: 10 }, (_, i) => ({ role: 'user' as const, content: `very long message number ${i}`.repeat(50) }));
    const result = await c.compactIfNeeded(msgs, null as any, new AbortController().signal);
    // Falls back to simple truncation since model is null
    expect(result.wasCompacted).toBe(true);
    expect(result.compacted).toHaveLength(4); // summary + 3 recent
    expect(result.removedTokens).toBeGreaterThan(0);
  });
});
```

```typescript
// token-economy.test.ts
import { describe, it, expect } from 'vitest';
import { TokenEconomy } from '../agent-loop/token-economy.js';

describe('TokenEconomy', () => {
  it('tracks usage', () => {
    const te = new TokenEconomy();
    te.track(100, 50);
    expect(te.getUsage()).toEqual({ input: 100, output: 50 });
  });

  it('detects input exhaustion', () => {
    const te = new TokenEconomy(100, 100);
    te.track(101, 0);
    expect(te.isInputExhausted()).toBe(true);
  });

  it('truncates tool output', () => {
    const te = new TokenEconomy(1000, 1000, 10);
    const result = te.truncateToolOutput('a'.repeat(50));
    expect(result).toHaveLength(13 + '... [truncated]'.length);
  });
});
```

- [ ] **Step 2: Run tests and commit**

```bash
cd vico/agent && npx vitest run
git add vico/agent/src/__tests__/
git commit -m "test(agent): add tests for memory, compactor, and token economy"
```
