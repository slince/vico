# Model Layer Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `ai` package `streamText` with `@ai-sdk/provider` `LanguageModelV3.doStream()` via a thin `ModelClient` wrapper, giving full visibility into prompt, tools, and stream processing.

**Architecture:** Build 4 new files in `packages/agent/src/model/` (model-client, prompt-converter, tool-converter, stream-processor) + 2 in `stream/` (sse, types), then wire them into Agent/AgentLoop/ContextCompactor/Vico. Remove implicit `ai` dependency, formalize `@ai-sdk/provider` dependency.

**Tech Stack:** TypeScript, `@ai-sdk/provider` v3.0.10, `@ai-sdk/provider-utils`, `@ai-sdk/openai`, `@ai-sdk/anthropic`, Vitest

## Global Constraints

- `@vico/agent` must not import from `ai` after completion
- All `as any` casts in model-calling paths must be eliminated
- `LanguageModelV3StreamPart` all variants must be mapped — no swallowed events
- Existing agent-loop behavior must not change (same TurnEvent sequence, same tool call flow)
- Client-facing SSE protocol must remain compatible with `@assistant-ui/react`

---

### Task 1: Define `ModelStreamChunk` and related types in `model/types.ts`

**Files:**
- Modify: `packages/agent/src/model/types.ts`

**Interfaces:**
- Produces: `ModelStreamChunk` (union), `ModelCallOptions`, `ModelStreamResult`, `ModelUsage` — consumed by all subsequent tasks

- [ ] **Step 1: Add types to `model/types.ts`**

Current file content:
```typescript
// @vico/agent - Model module type definitions

/** 消息角色 */
export type MessageRole = 'system' | 'user' | 'assistant' | 'tool';

/** 标准化消息格式 */
export interface ModelMessage {
  role: MessageRole;
  content: string;
  toolCallId?: string;
  toolCalls?: { id: string; name: string; args: Record<string, unknown> }[];
}
```

Append the following before the file ends:

```typescript
// ---- ModelClient types ----

import type { Tool } from '../tool/types.js';

/** Provider metadata — keyed by provider name */
type ProviderMetadata = Record<string, Record<string, unknown>>;

/** Warning from provider */
type StreamWarning = { type: string; feature?: string; message?: string };

/** Token usage */
export interface ModelUsage {
  inputTokens: number;
  outputTokens: number;
}

/** ModelClient.stream() 入参 */
export interface ModelCallOptions {
  system?: string;
  messages: ModelMessage[];
  tools?: Tool[];
  maxOutputTokens?: number;
  temperature?: number;
  abortSignal?: AbortSignal;
}

/** ModelClient.stream() 返回值 */
export interface ModelStreamResult {
  stream: AsyncGenerator<ModelStreamChunk>;
}

/**
 * ModelStreamChunk — LanguageModelV3StreamPart 完整映射。
 * 每个 provider stream part 变体逐项对应，不丢事件、不吞字段。
 * 仅 tool-call 的 input 从 string 解析为 unknown。
 */
export type ModelStreamChunk =
  // ── Text lifecycle ──
  | { type: 'text-start'; id: string; providerMetadata?: ProviderMetadata }
  | { type: 'text-delta'; id: string; delta: string; providerMetadata?: ProviderMetadata }
  | { type: 'text-end'; id: string; providerMetadata?: ProviderMetadata }
  // ── Reasoning lifecycle ──
  | { type: 'reasoning-start'; id: string; providerMetadata?: ProviderMetadata }
  | { type: 'reasoning-delta'; id: string; delta: string; providerMetadata?: ProviderMetadata }
  | { type: 'reasoning-end'; id: string; providerMetadata?: ProviderMetadata }
  // ── Tool input lifecycle ──
  | { type: 'tool-input-start'; id: string; toolName: string; providerExecuted?: boolean; dynamic?: boolean; title?: string; providerMetadata?: ProviderMetadata }
  | { type: 'tool-input-delta'; id: string; delta: string; providerMetadata?: ProviderMetadata }
  | { type: 'tool-input-end'; id: string; providerMetadata?: ProviderMetadata }
  // ── Tool call (aggregated, input parsed to unknown) ──
  | { type: 'tool-call'; toolCallId: string; toolName: string; input: unknown; providerExecuted?: boolean; dynamic?: boolean; providerMetadata?: ProviderMetadata }
  // ── Tool result (from provider) ──
  | { type: 'tool-result'; toolCallId: string; toolName: string; result: unknown; isError?: boolean; preliminary?: boolean; dynamic?: boolean; providerMetadata?: ProviderMetadata }
  // ── Tool approval request ──
  | { type: 'tool-approval-request'; approvalId: string; toolCallId: string; providerMetadata?: ProviderMetadata }
  // ── File ──
  | { type: 'file'; mediaType: string; data: string | Uint8Array; providerMetadata?: ProviderMetadata }
  // ── Source ──
  | { type: 'source'; sourceType: 'url'; id: string; url: string; title?: string; providerMetadata?: ProviderMetadata }
  | { type: 'source'; sourceType: 'document'; id: string; mediaType: string; title: string; filename?: string; providerMetadata?: ProviderMetadata }
  // ── Metadata ──
  | { type: 'stream-start'; warnings: StreamWarning[] }
  | { type: 'response-metadata'; id?: string; timestamp?: Date; modelId?: string }
  | { type: 'finish'; finishReason: string; rawFinishReason?: string; usage: ModelUsage; providerMetadata?: ProviderMetadata }
  | { type: 'raw'; rawValue: unknown }
  | { type: 'error'; message: string };
```

Wait, we can't import Tool from '../tool/types.js' because model/types.ts shouldn't depend on tool types. Instead, use an inline minimal type in ModelCallOptions:

```typescript
/** ModelClient.stream() 入参 */
export interface ModelCallOptions {
  system?: string;
  messages: ModelMessage[];
  tools?: { name: string; description: string; inputSchema: Record<string, unknown> }[];
  maxOutputTokens?: number;
  temperature?: number;
  abortSignal?: AbortSignal;
}
```

Actually, let's just import the Tool type. The model module already depends on tool conceptually. And the import is just a type import, no runtime cost.

Let me reconsider — looking at existing code, `model/types.ts` currently doesn't import anything. And `ModelCallOptions.tools` needs to accept the Tool type that agent-loop passes in. The cleanest approach:

`ModelCallOptions` uses a minimal `ToolDescriptor` type local to the model module:

```typescript
/** Tool descriptor for model call */
export interface ToolDescriptor {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}
```

This keeps model/types.ts independent.

But wait — the Tool type from `tool/types.ts` is:
```typescript
export interface Tool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;  // actually a zod schema but treated as record
  // ... other fields
}
```

And `tool-converter.ts` (which lives in the model module) will accept `Tool[]` and produce `LanguageModelV3FunctionTool[]`. So `ModelCallOptions.tools` should accept whatever the caller has — which is `Tool[]`.

Let me just use a generic shape. The simplest approach: define a `ToolDescriptor` in model/types, or just use `Pick<Tool, 'name' | 'description' | 'inputSchema'>[]`.

Actually, the simplest, cleanest approach: just use `{ name: string; description: string; inputSchema: Record<string, unknown> }[]`. This is what tool-converter actually needs.

- [ ] **Step 1 (revised): Add types to `model/types.ts`**

```typescript
// @vico/agent - Model module type definitions

/** 消息角色 */
export type MessageRole = 'system' | 'user' | 'assistant' | 'tool';

/** 标准化消息格式 */
export interface ModelMessage {
  role: MessageRole;
  content: string;
  toolCallId?: string;
  toolCalls?: { id: string; name: string; args: Record<string, unknown> }[];
}

// ── ModelClient types ──

/** Provider metadata — keyed by provider name */
type ProviderMetadata = Record<string, Record<string, unknown>>;

/** Warning from provider */
export type StreamWarning = {
  type: 'unsupported' | 'compatibility' | 'other';
  feature?: string;
  message?: string;
};

/** Token usage snapshot */
export interface ModelUsage {
  inputTokens: number;
  outputTokens: number;
}

/** Tool shape ModelClient accepts */
export interface ToolDescriptor {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/** ModelClient.stream() options */
export interface ModelCallOptions {
  system?: string;
  messages: ModelMessage[];
  tools?: ToolDescriptor[];
  maxOutputTokens?: number;
  temperature?: number;
  abortSignal?: AbortSignal;
}

/** ModelClient.stream() return */
export interface ModelStreamResult {
  stream: AsyncGenerator<ModelStreamChunk>;
}

/**
 * ModelStreamChunk — complete mirror of LanguageModelV3StreamPart.
 * Every variant mapped 1:1; only tool-call.input parsed from string to unknown.
 */
export type ModelStreamChunk =
  // Text lifecycle
  | { type: 'text-start'; id: string; providerMetadata?: ProviderMetadata }
  | { type: 'text-delta'; id: string; delta: string; providerMetadata?: ProviderMetadata }
  | { type: 'text-end'; id: string; providerMetadata?: ProviderMetadata }
  // Reasoning lifecycle
  | { type: 'reasoning-start'; id: string; providerMetadata?: ProviderMetadata }
  | { type: 'reasoning-delta'; id: string; delta: string; providerMetadata?: ProviderMetadata }
  | { type: 'reasoning-end'; id: string; providerMetadata?: ProviderMetadata }
  // Tool input lifecycle
  | { type: 'tool-input-start'; id: string; toolName: string; providerExecuted?: boolean; dynamic?: boolean; title?: string; providerMetadata?: ProviderMetadata }
  | { type: 'tool-input-delta'; id: string; delta: string; providerMetadata?: ProviderMetadata }
  | { type: 'tool-input-end'; id: string; providerMetadata?: ProviderMetadata }
  // Tool call (aggregated, input parsed)
  | { type: 'tool-call'; toolCallId: string; toolName: string; input: unknown; providerExecuted?: boolean; dynamic?: boolean; providerMetadata?: ProviderMetadata }
  // Tool result (from provider)
  | { type: 'tool-result'; toolCallId: string; toolName: string; result: unknown; isError?: boolean; preliminary?: boolean; dynamic?: boolean; providerMetadata?: ProviderMetadata }
  // Tool approval request
  | { type: 'tool-approval-request'; approvalId: string; toolCallId: string; providerMetadata?: ProviderMetadata }
  // File
  | { type: 'file'; mediaType: string; data: string | Uint8Array; providerMetadata?: ProviderMetadata }
  // Source (discriminated by sourceType)
  | { type: 'source'; sourceType: 'url'; id: string; url: string; title?: string; providerMetadata?: ProviderMetadata }
  | { type: 'source'; sourceType: 'document'; id: string; mediaType: string; title: string; filename?: string; providerMetadata?: ProviderMetadata }
  // Metadata
  | { type: 'stream-start'; warnings: StreamWarning[] }
  | { type: 'response-metadata'; id?: string; timestamp?: Date; modelId?: string }
  | { type: 'finish'; finishReason: string; rawFinishReason?: string; usage: ModelUsage; providerMetadata?: ProviderMetadata }
  | { type: 'raw'; rawValue: unknown }
  | { type: 'error'; message: string };
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd packages/agent && pnpm typecheck`
Expected: PASS (these are just type additions, no runtime code)

- [ ] **Step 3: Commit**

```bash
git add packages/agent/src/model/types.ts
git commit -m "feat(model): add ModelStreamChunk, ModelCallOptions, ModelStreamResult types"
```

---

### Task 2: Build `prompt-converter.ts`

**Files:**
- Create: `packages/agent/src/model/prompt-converter.ts`
- Create: `packages/agent/src/model/__tests__/prompt-converter.test.ts`

**Interfaces:**
- Consumes: `ModelMessage`, `ModelCallOptions` from `model/types.ts`
- Produces: `convertToPrompt(messages: ModelMessage[], system?: string): LanguageModelV3Prompt`

- [ ] **Step 1: Write failing test**

Create `packages/agent/src/model/__tests__/prompt-converter.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { convertToPrompt } from '../prompt-converter.js';
import type { ModelMessage } from '../types.js';

describe('convertToPrompt', () => {
  it('converts system option to system message', () => {
    const prompt = convertToPrompt([], 'You are helpful');
    expect(prompt).toEqual([
      { role: 'system', content: 'You are helpful' },
    ]);
  });

  it('omits system message when system is undefined', () => {
    const prompt = convertToPrompt([], undefined);
    expect(prompt).toEqual([]);
  });

  it('converts user message with text content', () => {
    const messages: ModelMessage[] = [{ role: 'user', content: 'Hello' }];
    const prompt = convertToPrompt(messages);
    expect(prompt).toEqual([
      { role: 'user', content: [{ type: 'text', text: 'Hello' }] },
    ]);
  });

  it('converts assistant message with text', () => {
    const messages: ModelMessage[] = [{ role: 'assistant', content: 'Hi there' }];
    const prompt = convertToPrompt(messages);
    expect(prompt).toEqual([
      { role: 'assistant', content: [{ type: 'text', text: 'Hi there' }] },
    ]);
  });

  it('converts assistant message with tool calls', () => {
    const messages: ModelMessage[] = [{
      role: 'assistant',
      content: 'Let me check',
      toolCalls: [{ id: 'tc1', name: 'search', args: { q: 'hello' } }],
    }];
    const prompt = convertToPrompt(messages);
    expect(prompt).toEqual([{
      role: 'assistant',
      content: [
        { type: 'text', text: 'Let me check' },
        { type: 'tool-call', toolCallId: 'tc1', toolName: 'search', input: { q: 'hello' } },
      ],
    }]);
  });

  it('converts assistant message with only tool calls (no text)', () => {
    const messages: ModelMessage[] = [{
      role: 'assistant',
      content: '',
      toolCalls: [{ id: 'tc1', name: 'search', args: {} }],
    }];
    const prompt = convertToPrompt(messages);
    expect(prompt).toEqual([{
      role: 'assistant',
      content: [
        { type: 'tool-call', toolCallId: 'tc1', toolName: 'search', input: {} },
      ],
    }]);
  });

  it('converts tool message', () => {
    const messages: ModelMessage[] = [{
      role: 'tool',
      content: 'result text',
      toolCallId: 'tc1',
    }];
    const prompt = convertToPrompt(messages);
    expect(prompt).toEqual([{
      role: 'tool',
      content: [{
        type: 'tool-result',
        toolCallId: 'tc1',
        toolName: '',
        output: { type: 'text', value: 'result text' },
      }],
    }]);
  });

  it('converts mixed conversation', () => {
    const messages: ModelMessage[] = [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi!', toolCalls: [{ id: 'tc1', name: 'greet', args: {} }] },
      { role: 'tool', content: 'ok', toolCallId: 'tc1' },
      { role: 'assistant', content: 'Done' },
    ];
    const prompt = convertToPrompt(messages, 'Be helpful');
    expect(prompt).toHaveLength(5); // system + 4 messages
    expect(prompt[0]).toEqual({ role: 'system', content: 'Be helpful' });
    expect(prompt[1].role).toBe('user');
    expect(prompt[2].role).toBe('assistant');
    expect(prompt[3].role).toBe('tool');
    expect(prompt[4].role).toBe('assistant');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/agent && pnpm test -- --run src/model/__tests__/prompt-converter.test.ts`
Expected: FAIL — `Cannot find module '../prompt-converter.js'`

- [ ] **Step 3: Implement `prompt-converter.ts`**

Create `packages/agent/src/model/prompt-converter.ts`:

```typescript
// @vico/agent - Convert internal ModelMessage[] to LanguageModelV3Prompt
import type { LanguageModelV3Prompt, LanguageModelV3Message } from '@ai-sdk/provider';
import type { ModelMessage } from './types.js';

/**
 * Convert Vico ModelMessage[] to provider-level LanguageModelV3Prompt.
 * System prompt is passed separately as the first message.
 */
export function convertToPrompt(messages: ModelMessage[], system?: string): LanguageModelV3Prompt {
  const prompt: LanguageModelV3Prompt = [];

  if (system) {
    prompt.push({ role: 'system', content: system });
  }

  for (const msg of messages) {
    prompt.push(convertMessage(msg));
  }

  return prompt;
}

function convertMessage(msg: ModelMessage): LanguageModelV3Message {
  switch (msg.role) {
    case 'user':
      return {
        role: 'user',
        content: [{ type: 'text', text: msg.content }],
      };

    case 'assistant': {
      const parts: LanguageModelV3Message['content'] = [];
      if (msg.content) {
        parts.push({ type: 'text', text: msg.content });
      }
      for (const tc of msg.toolCalls ?? []) {
        parts.push({
          type: 'tool-call',
          toolCallId: tc.id,
          toolName: tc.name,
          input: tc.args,
        });
      }
      // Content array must not be empty
      if (parts.length === 0) {
        parts.push({ type: 'text', text: '' });
      }
      return { role: 'assistant', content: parts };
    }

    case 'tool':
      return {
        role: 'tool',
        content: [{
          type: 'tool-result',
          toolCallId: msg.toolCallId!,
          toolName: '',
          output: { type: 'text', value: msg.content },
        }],
      };

    default:
      // system messages in history are treated as user (shouldn't normally happen)
      return {
        role: 'user',
        content: [{ type: 'text', text: msg.content }],
      };
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/agent && pnpm test -- --run src/model/__tests__/prompt-converter.test.ts`
Expected: 6 tests PASS

- [ ] **Step 5: Commit**

```bash
git add packages/agent/src/model/prompt-converter.ts packages/agent/src/model/__tests__/prompt-converter.test.ts
git commit -m "feat(model): add prompt-converter — ModelMessage[] to LanguageModelV3Prompt"
```

---

### Task 3: Build `tool-converter.ts`

**Files:**
- Create: `packages/agent/src/model/tool-converter.ts`
- Create: `packages/agent/src/model/__tests__/tool-converter.test.ts`

**Interfaces:**
- Consumes: `ToolDescriptor` from `model/types.ts`
- Produces: `convertTools(tools: ToolDescriptor[]): LanguageModelV3FunctionTool[]`

- [ ] **Step 1: Write failing test**

Create `packages/agent/src/model/__tests__/tool-converter.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { convertTools } from '../tool-converter.js';
import type { ToolDescriptor } from '../types.js';

describe('convertTools', () => {
  it('returns empty array for empty input', () => {
    expect(convertTools([])).toEqual([]);
  });

  it('converts single tool', () => {
    const tools: ToolDescriptor[] = [{
      name: 'search',
      description: 'Search the web',
      inputSchema: {
        type: 'object',
        properties: { q: { type: 'string' } },
        required: ['q'],
      },
    }];
    const result = convertTools(tools);
    expect(result).toEqual([{
      type: 'function',
      name: 'search',
      description: 'Search the web',
      inputSchema: {
        type: 'object',
        properties: { q: { type: 'string' } },
        required: ['q'],
      },
    }]);
  });

  it('converts multiple tools', () => {
    const tools: ToolDescriptor[] = [
      { name: 'read', description: 'Read a file', inputSchema: { type: 'object', properties: {} } },
      { name: 'write', description: 'Write a file', inputSchema: { type: 'object', properties: {} } },
    ];
    const result = convertTools(tools);
    expect(result).toHaveLength(2);
    expect(result[0].type).toBe('function');
    expect(result[1].type).toBe('function');
    expect(result[0].name).toBe('read');
    expect(result[1].name).toBe('write');
  });

  it('handles tool without description', () => {
    const tools: ToolDescriptor[] = [{
      name: 'silent',
      description: '',
      inputSchema: { type: 'object', properties: {} },
    }];
    const result = convertTools(tools);
    expect(result[0].description).toBe('');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/agent && pnpm test -- --run src/model/__tests__/tool-converter.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement `tool-converter.ts`**

Create `packages/agent/src/model/tool-converter.ts`:

```typescript
// @vico/agent - Convert Vico Tool[] to LanguageModelV3FunctionTool[]
import type { LanguageModelV3FunctionTool } from '@ai-sdk/provider';
import type { ToolDescriptor } from './types.js';

/**
 * Convert Vico ToolDescriptor[] to provider-level LanguageModelV3FunctionTool[].
 */
export function convertTools(tools: ToolDescriptor[]): LanguageModelV3FunctionTool[] {
  return tools.map(t => ({
    type: 'function' as const,
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema as LanguageModelV3FunctionTool['inputSchema'],
  }));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/agent && pnpm test -- --run src/model/__tests__/tool-converter.test.ts`
Expected: 4 tests PASS

- [ ] **Step 5: Commit**

```bash
git add packages/agent/src/model/tool-converter.ts packages/agent/src/model/__tests__/tool-converter.test.ts
git commit -m "feat(model): add tool-converter — ToolDescriptor[] to LanguageModelV3FunctionTool[]"
```

---

### Task 4: Build `stream-processor.ts`

**Files:**
- Create: `packages/agent/src/model/stream-processor.ts`
- Create: `packages/agent/src/model/__tests__/stream-processor.test.ts`

**Interfaces:**
- Consumes: `ModelStreamChunk`, `ModelUsage`, `StreamWarning` from `model/types.ts`
- Produces: `processStreamParts(stream: ReadableStream<LanguageModelV3StreamPart>): AsyncGenerator<ModelStreamChunk>`

- [ ] **Step 1: Write failing test**

Create `packages/agent/src/model/__tests__/stream-processor.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { processStreamParts } from '../stream-processor.js';
import type { LanguageModelV3StreamPart } from '@ai-sdk/provider';
import type { ModelStreamChunk } from '../types.js';

/** Helper: create a readable stream from LanguageModelV3StreamPart array */
function createMockStream(parts: LanguageModelV3StreamPart[]): ReadableStream<LanguageModelV3StreamPart> {
  return new ReadableStream({
    start(controller) {
      for (const part of parts) {
        controller.enqueue(part);
      }
      controller.close();
    },
  });
}

/** Helper: collect all chunks from async generator */
async function collect<T>(gen: AsyncGenerator<T>): Promise<T[]> {
  const items: T[] = [];
  for await (const item of gen) {
    items.push(item);
  }
  return items;
}

describe('processStreamParts', () => {
  it('processes text lifecycle events', async () => {
    const stream = createMockStream([
      { type: 'text-start', id: 't1' },
      { type: 'text-delta', id: 't1', delta: 'Hello' },
      { type: 'text-delta', id: 't1', delta: ' World' },
      { type: 'text-end', id: 't1' },
    ]);
    const chunks = await collect(processStreamParts(stream));
    expect(chunks).toEqual([
      { type: 'text-start', id: 't1' },
      { type: 'text-delta', id: 't1', delta: 'Hello' },
      { type: 'text-delta', id: 't1', delta: ' World' },
      { type: 'text-end', id: 't1' },
    ]);
  });

  it('processes reasoning lifecycle events', async () => {
    const stream = createMockStream([
      { type: 'reasoning-start', id: 'r1' },
      { type: 'reasoning-delta', id: 'r1', delta: 'thinking...' },
      { type: 'reasoning-end', id: 'r1' },
    ]);
    const chunks = await collect(processStreamParts(stream));
    expect(chunks).toEqual([
      { type: 'reasoning-start', id: 'r1' },
      { type: 'reasoning-delta', id: 'r1', delta: 'thinking...' },
      { type: 'reasoning-end', id: 'r1' },
    ]);
  });

  it('processes tool call with buffered deltas', async () => {
    const stream = createMockStream([
      { type: 'tool-input-start', id: 'tc1', toolName: 'search' },
      { type: 'tool-input-delta', id: 'tc1', delta: '{"q":' },
      { type: 'tool-input-delta', id: 'tc1', delta: '"hello"}' },
      { type: 'tool-input-end', id: 'tc1' },
      { type: 'tool-call', toolCallId: 'tc1', toolName: 'search', input: '{"q":"hello"}' },
    ]);
    const chunks = await collect(processStreamParts(stream));

    expect(chunks).toHaveLength(5);
    expect(chunks[4]).toEqual({
      type: 'tool-call',
      toolCallId: 'tc1',
      toolName: 'search',
      input: { q: 'hello' },
      providerExecuted: undefined,
      dynamic: undefined,
      providerMetadata: undefined,
    });
  });

  it('falls back to buffer when tool-call input parsing fails', async () => {
    const stream = createMockStream([
      { type: 'tool-input-start', id: 'tc1', toolName: 'bad' },
      { type: 'tool-input-delta', id: 'tc1', delta: 'valid json' },
      { type: 'tool-input-end', id: 'tc1' },
      { type: 'tool-call', toolCallId: 'tc1', toolName: 'bad', input: 'not-valid-json' },
    ]);
    const chunks = await collect(processStreamParts(stream));
    // Should fallback to buffer'd text
    expect(chunks[4].type).toBe('tool-call');
    expect(chunks[4]).toMatchObject({
      type: 'tool-call',
      toolCallId: 'tc1',
      toolName: 'bad',
      input: 'valid json',
    });
  });

  it('processes finish event with usage', async () => {
    const stream = createMockStream([
      {
        type: 'finish',
        finishReason: { unified: 'stop', raw: 'stop' },
        usage: {
          inputTokens: { total: 100, noCache: 50, cacheRead: 30, cacheWrite: 20 },
          outputTokens: { total: 50, text: 50, reasoning: 0 },
        },
      },
    ]);
    const chunks = await collect(processStreamParts(stream));
    expect(chunks).toEqual([{
      type: 'finish',
      finishReason: 'stop',
      rawFinishReason: 'stop',
      usage: { inputTokens: 100, outputTokens: 50 },
      providerMetadata: undefined,
    }]);
  });

  it('processes error event', async () => {
    const err = new Error('API error');
    const stream = createMockStream([
      { type: 'error', error: err },
    ]);
    const chunks = await collect(processStreamParts(stream));
    expect(chunks).toEqual([{
      type: 'error',
      message: 'API error',
    }]);
  });

  it('processes stream-start with warnings', async () => {
    const stream = createMockStream([
      { type: 'stream-start', warnings: [{ type: 'unsupported', feature: 'top_k' }] },
    ]);
    const chunks = await collect(processStreamParts(stream));
    expect(chunks).toEqual([{
      type: 'stream-start',
      warnings: [{ type: 'unsupported', feature: 'top_k' }],
    }]);
  });

  it('processes tool-result from provider', async () => {
    const stream = createMockStream([
      { type: 'tool-result', toolCallId: 'tc1', toolName: 'search', result: { answer: '42' }, isError: false },
    ]);
    const chunks = await collect(processStreamParts(stream));
    expect(chunks).toEqual([{
      type: 'tool-result',
      toolCallId: 'tc1',
      toolName: 'search',
      result: { answer: '42' },
      isError: false,
      preliminary: undefined,
      dynamic: undefined,
      providerMetadata: undefined,
    }]);
  });

  it('processes tool-approval-request', async () => {
    const stream = createMockStream([
      { type: 'tool-approval-request', approvalId: 'a1', toolCallId: 'tc1' },
    ]);
    const chunks = await collect(processStreamParts(stream));
    expect(chunks).toEqual([{
      type: 'tool-approval-request',
      approvalId: 'a1',
      toolCallId: 'tc1',
      providerMetadata: undefined,
    }]);
  });

  it('processes file and source events', async () => {
    const stream = createMockStream([
      { type: 'file', mediaType: 'image/png', data: 'base64...' },
      { type: 'source', sourceType: 'url', id: 's1', url: 'https://example.com' },
    ]);
    const chunks = await collect(processStreamParts(stream));
    expect(chunks).toEqual([
      { type: 'file', mediaType: 'image/png', data: 'base64...', providerMetadata: undefined },
      { type: 'source', sourceType: 'url', id: 's1', url: 'https://example.com', title: undefined, providerMetadata: undefined },
    ]);
  });

  it('processes response-metadata and raw events', async () => {
    const stream = createMockStream([
      { type: 'response-metadata', id: 'resp1', timestamp: new Date('2026-01-01'), modelId: 'gpt-4o' },
      { type: 'raw', rawValue: { x: 1 } },
    ]);
    const chunks = await collect(processStreamParts(stream));
    expect(chunks).toEqual([
      { type: 'response-metadata', id: 'resp1', timestamp: new Date('2026-01-01'), modelId: 'gpt-4o' },
      { type: 'raw', rawValue: { x: 1 } },
    ]);
  });

  it('handles empty stream', async () => {
    const stream = createMockStream([]);
    const chunks = await collect(processStreamParts(stream));
    expect(chunks).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/agent && pnpm test -- --run src/model/__tests__/stream-processor.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement `stream-processor.ts`**

Create `packages/agent/src/model/stream-processor.ts`:

```typescript
// @vico/agent - Convert ReadableStream<LanguageModelV3StreamPart> to AsyncGenerator<ModelStreamChunk>
import type { LanguageModelV3StreamPart } from '@ai-sdk/provider';
import type { ModelStreamChunk } from './types.js';

/**
 * Process raw provider stream parts into our typed ModelStreamChunk generator.
 * Every LanguageModelV3StreamPart variant is mapped. Tool call input is parsed
 * from string to unknown, with buffered delta fallback.
 */
export async function* processStreamParts(
  stream: ReadableStream<LanguageModelV3StreamPart>,
): AsyncGenerator<ModelStreamChunk> {
  const reader = stream.getReader();

  // Buffer incremental tool input deltas keyed by tool call id
  const toolInputBuffers = new Map<string, string>();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      switch (value.type) {
        // ── Text lifecycle ──
        case 'text-start':
          yield { type: 'text-start', id: value.id, providerMetadata: value.providerMetadata };
          break;
        case 'text-delta':
          yield { type: 'text-delta', id: value.id, delta: value.delta, providerMetadata: value.providerMetadata };
          break;
        case 'text-end':
          yield { type: 'text-end', id: value.id, providerMetadata: value.providerMetadata };
          break;

        // ── Reasoning lifecycle ──
        case 'reasoning-start':
          yield { type: 'reasoning-start', id: value.id, providerMetadata: value.providerMetadata };
          break;
        case 'reasoning-delta':
          yield { type: 'reasoning-delta', id: value.id, delta: value.delta, providerMetadata: value.providerMetadata };
          break;
        case 'reasoning-end':
          yield { type: 'reasoning-end', id: value.id, providerMetadata: value.providerMetadata };
          break;

        // ── Tool input lifecycle ──
        case 'tool-input-start':
          toolInputBuffers.set(value.id, '');
          yield {
            type: 'tool-input-start',
            id: value.id,
            toolName: value.toolName,
            providerExecuted: value.providerExecuted,
            dynamic: value.dynamic,
            title: value.title,
            providerMetadata: value.providerMetadata,
          };
          break;
        case 'tool-input-delta':
          if (toolInputBuffers.has(value.id)) {
            toolInputBuffers.set(value.id, toolInputBuffers.get(value.id)! + value.delta);
          }
          yield { type: 'tool-input-delta', id: value.id, delta: value.delta, providerMetadata: value.providerMetadata };
          break;
        case 'tool-input-end':
          yield { type: 'tool-input-end', id: value.id, providerMetadata: value.providerMetadata };
          break;

        // ── Tool call (parse input) ──
        case 'tool-call': {
          const buffered = toolInputBuffers.get(value.toolCallId);
          toolInputBuffers.delete(value.toolCallId);

          let input: unknown;
          try {
            input = typeof value.input === 'string' ? JSON.parse(value.input) : value.input;
          } catch {
            if (buffered) {
              try { input = JSON.parse(buffered); } catch { input = buffered; }
            } else {
              input = value.input;
            }
          }

          yield {
            type: 'tool-call',
            toolCallId: value.toolCallId,
            toolName: value.toolName,
            input,
            providerExecuted: value.providerExecuted,
            dynamic: value.dynamic,
            providerMetadata: value.providerMetadata,
          };
          break;
        }

        // ── Tool result (provider-executed) ──
        case 'tool-result':
          yield {
            type: 'tool-result',
            toolCallId: value.toolCallId,
            toolName: value.toolName,
            result: value.result,
            isError: value.isError,
            preliminary: value.preliminary,
            dynamic: value.dynamic,
            providerMetadata: value.providerMetadata,
          };
          break;

        // ── Tool approval request ──
        case 'tool-approval-request':
          yield {
            type: 'tool-approval-request',
            approvalId: value.approvalId,
            toolCallId: value.toolCallId,
            providerMetadata: value.providerMetadata,
          };
          break;

        // ── File ──
        case 'file':
          yield {
            type: 'file',
            mediaType: value.mediaType,
            data: value.data,
            providerMetadata: value.providerMetadata,
          };
          break;

        // ── Source ──
        case 'source':
          if (value.sourceType === 'url') {
            yield {
              type: 'source',
              sourceType: 'url',
              id: value.id,
              url: value.url,
              title: value.title,
              providerMetadata: value.providerMetadata,
            };
          } else {
            yield {
              type: 'source',
              sourceType: 'document',
              id: value.id,
              mediaType: value.mediaType,
              title: value.title,
              filename: value.filename,
              providerMetadata: value.providerMetadata,
            };
          }
          break;

        // ── Metadata ──
        case 'stream-start':
          yield { type: 'stream-start', warnings: value.warnings };
          break;
        case 'response-metadata':
          yield {
            type: 'response-metadata',
            id: value.id,
            timestamp: value.timestamp,
            modelId: value.modelId,
          };
          break;

        // ── Finish ──
        case 'finish':
          yield {
            type: 'finish',
            finishReason: value.finishReason.unified,
            rawFinishReason: value.finishReason.raw,
            usage: {
              inputTokens: value.usage.inputTokens?.total ?? 0,
              outputTokens: value.usage.outputTokens?.total ?? 0,
            },
            providerMetadata: value.providerMetadata,
          };
          break;

        // ── Raw ──
        case 'raw':
          yield { type: 'raw', rawValue: value.rawValue };
          break;

        // ── Error ──
        case 'error':
          yield {
            type: 'error',
            message: value.error instanceof Error ? value.error.message : String(value.error),
          };
          break;
      }
    }
  } finally {
    reader.releaseLock();
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/agent && pnpm test -- --run src/model/__tests__/stream-processor.test.ts`
Expected: 11 tests PASS

- [ ] **Step 5: Commit**

```bash
git add packages/agent/src/model/stream-processor.ts packages/agent/src/model/__tests__/stream-processor.test.ts
git commit -m "feat(model): add stream-processor — ReadableStream<StreamPart> to AsyncGenerator<ModelStreamChunk>"
```

---

### Task 5: Build `ModelClient`

**Files:**
- Create: `packages/agent/src/model/model-client.ts`
- Create: `packages/agent/src/model/__tests__/model-client.test.ts`

**Interfaces:**
- Consumes: All model/ components (prompt-converter, tool-converter, stream-processor, types)
- Produces: `ModelClient` class with `stream(options): Promise<ModelStreamResult>`

- [ ] **Step 1: Write failing test**

Create `packages/agent/src/model/__tests__/model-client.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { ModelClient } from '../model-client.js';
import type { LanguageModelV3, LanguageModelV3CallOptions, LanguageModelV3StreamResult } from '@ai-sdk/provider';
import type { ModelStreamChunk } from '../types.js';

/** Create a mock LanguageModelV3 with controllable doStream */
function createMockModel(
  doStreamFn: (opts: LanguageModelV3CallOptions) => Promise<LanguageModelV3StreamResult>,
): LanguageModelV3 {
  return {
    specificationVersion: 'v3',
    provider: 'mock',
    modelId: 'mock-model',
    supportedUrls: {},
    doGenerate: vi.fn().mockRejectedValue(new Error('not implemented')),
    doStream: vi.fn().mockImplementation(doStreamFn),
  };
}

describe('ModelClient', () => {
  it('calls model.doStream with converted prompt and tools', async () => {
    const doStream = vi.fn().mockResolvedValue({
      stream: new ReadableStream({
        start(c) {
          c.enqueue({ type: 'text-delta', id: 't1', delta: 'Hi' });
          c.close();
        },
      }),
    });

    const model = createMockModel(doStream);
    const client = new ModelClient(model);

    const { stream } = await client.stream({
      system: 'be helpful',
      messages: [{ role: 'user', content: 'Hello' }],
      tools: [{ name: 'search', description: 'Search', inputSchema: { type: 'object', properties: {} } }],
      maxOutputTokens: 100,
      temperature: 0.5,
    });

    expect(doStream).toHaveBeenCalledTimes(1);
    const callOpts: LanguageModelV3CallOptions = doStream.mock.calls[0][0];

    // Check prompt
    expect(callOpts.prompt).toEqual([
      { role: 'system', content: 'be helpful' },
      { role: 'user', content: [{ type: 'text', text: 'Hello' }] },
    ]);

    // Check tools
    expect(callOpts.tools).toEqual([{
      type: 'function',
      name: 'search',
      description: 'Search',
      inputSchema: { type: 'object', properties: {} },
    }]);

    // Check options forwarded
    expect(callOpts.maxOutputTokens).toBe(100);
    expect(callOpts.temperature).toBe(0.5);

    // Consume stream
    const chunks: ModelStreamChunk[] = [];
    for await (const c of stream) chunks.push(c);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].type).toBe('text-delta');
  });

  it('works without tools', async () => {
    const doStream = vi.fn().mockResolvedValue({
      stream: new ReadableStream({ start(c) { c.close(); } }),
    });
    const model = createMockModel(doStream);
    const client = new ModelClient(model);

    await client.stream({
      messages: [{ role: 'user', content: 'Hi' }],
    });

    expect(doStream.mock.calls[0][0].tools).toBeUndefined();
  });

  it('passes abortSignal through', async () => {
    const doStream = vi.fn().mockResolvedValue({
      stream: new ReadableStream({ start(c) { c.close(); } }),
    });
    const model = createMockModel(doStream);
    const client = new ModelClient(model);
    const signal = new AbortController().signal;

    await client.stream({ messages: [{ role: 'user', content: 'Hi' }], abortSignal: signal });
    expect(doStream.mock.calls[0][0].abortSignal).toBe(signal);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/agent && pnpm test -- --run src/model/__tests__/model-client.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement `model-client.ts`**

Create `packages/agent/src/model/model-client.ts`:

```typescript
// @vico/agent - ModelClient: thin wrapper over LanguageModelV3.doStream()
import type { LanguageModelV3 } from '@ai-sdk/provider';
import { convertToPrompt } from './prompt-converter.js';
import { convertTools } from './tool-converter.js';
import { processStreamParts } from './stream-processor.js';
import type { ModelCallOptions, ModelStreamResult } from './types.js';

/**
 * Thin wrapper over provider-level language model.
 * Converts Vico types to provider types, calls doStream(), and processes the raw stream.
 */
export class ModelClient {
  constructor(private model: LanguageModelV3) {}

  /**
   * Stream a model response. Converts internal types to provider format,
   * calls the model, and returns a typed async generator of stream chunks.
   */
  async stream(options: ModelCallOptions): Promise<ModelStreamResult> {
    const prompt = convertToPrompt(options.messages, options.system);
    const tools = options.tools?.length ? convertTools(options.tools) : undefined;

    const result = await this.model.doStream({
      prompt,
      tools,
      maxOutputTokens: options.maxOutputTokens,
      temperature: options.temperature,
      abortSignal: options.abortSignal,
    });

    return {
      stream: processStreamParts(result.stream),
    };
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/agent && pnpm test -- --run src/model/__tests__/model-client.test.ts`
Expected: 3 tests PASS

- [ ] **Step 5: Commit**

```bash
git add packages/agent/src/model/model-client.ts packages/agent/src/model/__tests__/model-client.test.ts
git commit -m "feat(model): add ModelClient — thin wrapper over LanguageModelV3.doStream()"
```

---

### Task 6: Build SSE formatter + UI stream types

**Files:**
- Create: `packages/agent/src/stream/types.ts`
- Create: `packages/agent/src/stream/sse.ts`
- Create: `packages/agent/src/stream/__tests__/sse.test.ts`

**Interfaces:**
- Produces: `UIStreamChunk` type (used by `turn-stream.ts`), `createSSEResponse(stream, headers?): Response`

- [ ] **Step 1: Define `UIStreamChunk` type**

Create `packages/agent/src/stream/types.ts`:

```typescript
// @vico/agent - UI stream type definitions (mirror of AI SDK UIMessageChunk)

/** Metadata attached to stream chunks */
type ProviderMetadata = Record<string, Record<string, unknown>>;

/**
 * UIStreamChunk — mirror of ai package's UIMessageChunk.
 * Defines the SSE protocol between server and client (@assistant-ui/react).
 * Only the variants actually used by turn-stream.ts are needed, but the full
 * set is defined for forward compatibility.
 */
export type UIStreamChunk =
  // Message lifecycle
  | { type: 'start'; messageId?: string; messageMetadata?: unknown }
  | { type: 'finish'; finishReason?: 'stop' | 'length' | 'content-filter' | 'tool-calls' | 'error' | 'other'; messageMetadata?: unknown }
  | { type: 'abort'; reason?: string }
  | { type: 'message-metadata'; messageMetadata: unknown }
  // Step lifecycle
  | { type: 'start-step' }
  | { type: 'finish-step' }
  // Text lifecycle
  | { type: 'text-start'; id: string; providerMetadata?: ProviderMetadata }
  | { type: 'text-delta'; id: string; delta: string; providerMetadata?: ProviderMetadata }
  | { type: 'text-end'; id: string; providerMetadata?: ProviderMetadata }
  // Reasoning lifecycle
  | { type: 'reasoning-start'; id: string; providerMetadata?: ProviderMetadata }
  | { type: 'reasoning-delta'; id: string; delta: string; providerMetadata?: ProviderMetadata }
  | { type: 'reasoning-end'; id: string; providerMetadata?: ProviderMetadata }
  // Tool input lifecycle
  | { type: 'tool-input-start'; toolCallId: string; toolName: string; providerExecuted?: boolean; dynamic?: boolean; title?: string; providerMetadata?: ProviderMetadata; toolMetadata?: Record<string, unknown> }
  | { type: 'tool-input-delta'; toolCallId: string; inputTextDelta: string }
  | { type: 'tool-input-available'; toolCallId: string; toolName: string; input: unknown; providerExecuted?: boolean; dynamic?: boolean; providerMetadata?: ProviderMetadata; toolMetadata?: Record<string, unknown>; title?: string }
  | { type: 'tool-input-error'; toolCallId: string; toolName: string; input: unknown; errorText: string; providerExecuted?: boolean; dynamic?: boolean; providerMetadata?: ProviderMetadata; toolMetadata?: Record<string, unknown>; title?: string }
  // Tool output lifecycle
  | { type: 'tool-output-available'; toolCallId: string; output: unknown; providerExecuted?: boolean; dynamic?: boolean; preliminary?: boolean; providerMetadata?: ProviderMetadata; toolMetadata?: Record<string, unknown> }
  | { type: 'tool-output-error'; toolCallId: string; errorText: string; providerExecuted?: boolean; dynamic?: boolean; providerMetadata?: ProviderMetadata; toolMetadata?: Record<string, unknown> }
  | { type: 'tool-output-denied'; toolCallId: string }
  | { type: 'tool-approval-request'; approvalId: string; toolCallId: string; signature?: string }
  // Sources
  | { type: 'source-url'; sourceId: string; url: string; title?: string; providerMetadata?: ProviderMetadata }
  | { type: 'source-document'; sourceId: string; mediaType: string; title: string; filename?: string; providerMetadata?: ProviderMetadata }
  // File
  | { type: 'file'; url: string; mediaType: string; providerMetadata?: ProviderMetadata }
  // Error
  | { type: 'error'; errorText: string }
  // Data (dynamic extension)
  | { type: `data-${string}`; id?: string; data: unknown; transient?: boolean };
```

- [ ] **Step 2: Write failing test for SSE**

Create `packages/agent/src/stream/__tests__/sse.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { createSSEResponse } from '../sse.js';
import type { UIStreamChunk } from '../types.js';

async function readSSEBody(response: Response): Promise<string[]> {
  const text = await response.text();
  return text.split('\n\n').filter(Boolean);
}

describe('createSSEResponse', () => {
  it('returns a Response with text/event-stream content type', () => {
    const stream = new ReadableStream<UIStreamChunk>({
      start(c) { c.enqueue({ type: 'start' }); c.close(); },
    });
    const response = createSSEResponse(stream);
    expect(response.headers.get('Content-Type')).toBe('text/event-stream');
  });

  it('formats chunks as SSE data lines', async () => {
    const stream = new ReadableStream<UIStreamChunk>({
      start(c) {
        c.enqueue({ type: 'start' });
        c.enqueue({ type: 'text-delta', id: 't1', delta: 'Hello' });
        c.enqueue({ type: 'finish', finishReason: 'stop' });
        c.close();
      },
    });
    const response = createSSEResponse(stream);
    const lines = await readSSEBody(response);
    expect(lines).toEqual([
      'data: {"type":"start"}',
      'data: {"type":"text-delta","id":"t1","delta":"Hello"}',
      'data: {"type":"finish","finishReason":"stop"}',
    ]);
  });

  it('sets custom headers', () => {
    const stream = new ReadableStream<UIStreamChunk>({
      start(c) { c.close(); },
    });
    const response = createSSEResponse(stream, {
      'Cache-Control': 'no-cache',
      'X-Custom': 'test',
    });
    expect(response.headers.get('Cache-Control')).toBe('no-cache');
    expect(response.headers.get('X-Custom')).toBe('test');
  });

  it('includes default headers (Cache-Control, Connection)', () => {
    const stream = new ReadableStream<UIStreamChunk>({
      start(c) { c.close(); },
    });
    const response = createSSEResponse(stream);
    expect(response.headers.get('Cache-Control')).toBe('no-cache');
    expect(response.headers.get('Connection')).toBe('keep-alive');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd packages/agent && pnpm test -- --run src/stream/__tests__/sse.test.ts`
Expected: FAIL

- [ ] **Step 4: Implement `sse.ts`**

Create `packages/agent/src/stream/sse.ts`:

```typescript
// @vico/agent - SSE response formatter (replaces ai's createUIMessageStreamResponse)

/**
 * Create an SSE (Server-Sent Events) Response from a ReadableStream of chunks.
 * Each chunk is serialized as `data: <JSON>\n\n`.
 */
export function createSSEResponse(
  stream: ReadableStream<unknown>,
  headers?: Record<string, string>,
): Response {
  const encoder = new TextEncoder();

  const sseStream = new ReadableStream({
    async start(controller) {
      const reader = stream.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const line = `data: ${JSON.stringify(value)}\n\n`;
          controller.enqueue(encoder.encode(line));
        }
      } finally {
        reader.releaseLock();
        controller.close();
      }
    },
  });

  return new Response(sseStream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      ...headers,
    },
  });
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd packages/agent && pnpm test -- --run src/stream/__tests__/sse.test.ts`
Expected: 4 tests PASS

- [ ] **Step 6: Commit**

```bash
git add packages/agent/src/stream/types.ts packages/agent/src/stream/sse.ts packages/agent/src/stream/__tests__/sse.test.ts
git commit -m "feat(stream): add SSE formatter + UIStreamChunk types, replace createUIMessageStreamResponse"
```

---

### Task 7: Update factory.ts + Agent class

**Files:**
- Modify: `packages/agent/src/model/factory.ts`
- Modify: `packages/agent/src/agent-loop/agent.ts`

**Interfaces:**
- Consumes: `ModelClient` from `model/model-client.ts`
- Produces: `Agent` now has `model: LanguageModelV3` + `modelClient: ModelClient`

- [ ] **Step 1: Update `factory.ts`**

Change `packages/agent/src/model/factory.ts`:

```diff
- import type { LanguageModel } from 'ai';
+ import type { LanguageModelV3 } from '@ai-sdk/provider';

- export function createLanguageModel(ref: ModelRef): LanguageModel {
+ export function createLanguageModel(ref: ModelRef): LanguageModelV3 {
```

- [ ] **Step 2: Update `agent.ts`**

Change `packages/agent/src/agent-loop/agent.ts`:

```diff
- import type { LanguageModel } from 'ai';
+ import type { LanguageModelV3 } from '@ai-sdk/provider';
+ import { ModelClient } from '../model/model-client.js';

  export class Agent {
    readonly config: AgentConfig;
-   readonly languageModel: LanguageModel;
+   readonly model: LanguageModelV3;
+   readonly modelClient: ModelClient;

    constructor(params: {
      config: AgentConfig;
-     languageModel: LanguageModel;
+     model: LanguageModelV3;
      // ...
    }) {
      this.config = params.config;
-     this.languageModel = params.languageModel;
+     this.model = params.model;
+     this.modelClient = new ModelClient(params.model);
```

- [ ] **Step 3: Verify typecheck**

Run: `cd packages/agent && pnpm typecheck`
Expected: errors in files not yet updated (agent-loop.ts, context-compactor.ts, vico.ts — expected, will fix in next tasks)

- [ ] **Step 4: Commit**

```bash
git add packages/agent/src/model/factory.ts packages/agent/src/agent-loop/agent.ts
git commit -m "refactor(agent): switch from LanguageModel to LanguageModelV3, inject ModelClient"
```

---

### Task 8: Replace `streamText` in `agent-loop.ts`

**Files:**
- Modify: `packages/agent/src/agent-loop/agent-loop.ts`

**Interfaces:**
- Consumes: `ModelClient.stream()`, `ModelStreamChunk` from `model/`
- Produces: Same `TurnEvent` sequence, same tool call flow

- [ ] **Step 1: Update imports and `callModel()`**

```diff
- import { streamText } from 'ai';
- import { toAISDKTools } from '../tool/utils.js';

  private async *callModel(
    messages: ModelMessage[],
    threadId: string,
    scopeId: string,
    signal: AbortSignal,
    usage: { input: number; output: number },
    step: number,
  ): AsyncGenerator<TurnEvent> {
    const ctx = new ModelRequestContext({ ... });
    await this.pipeline.run(ctx);
    const request = buildModelRequest(ctx);

    let fullText = '';
    const toolCalls: ToolCall[] = [];
    const modelSpan = this.spanTracker.startSpan('model_step', { step: step + 1 });

-   const result = streamText({
-     model: this.agent.languageModel,
-     system: request.system,
-     messages: request.messages as any,
-     tools: toAISDKTools(request.tools) as any,
-     maxOutputTokens: request.maxTokens,
-     temperature: request.temperature,
-     abortSignal: signal,
-   });
+   const { stream } = await this.agent.modelClient.stream({
+     system: request.system,
+     messages: request.messages,
+     tools: request.tools,  // Tool[] structurally matches ToolDescriptor[]
+     maxOutputTokens: request.maxTokens,
+     temperature: request.temperature,
+     abortSignal: signal,
+   });

    try {
-     for await (const chunk of result.fullStream) {
+     for await (const chunk of stream) {
        switch (chunk.type) {
          case 'text-delta':
-           fullText += chunk.text;
+           fullText += chunk.delta;      // was chunk.text, now chunk.delta
-           yield this.emit({ type: 'text-delta', content: chunk.text });
+           yield this.emit({ type: 'text-delta', content: chunk.delta });
            break;
          case 'reasoning-delta':
-           yield this.emit({ type: 'reasoning-delta', content: chunk.text });
+           yield this.emit({ type: 'reasoning-delta', content: chunk.delta });
            break;
          case 'tool-call':
-           toolCalls.push({ id: chunk.toolCallId, name: chunk.toolName, args: chunk.input as Record<string, unknown> });
+           toolCalls.push({ id: chunk.toolCallId, name: chunk.toolName, args: (chunk.input ?? {}) as Record<string, unknown> });
            yield this.emit({ type: 'tool-call-start', id: chunk.toolCallId, name: chunk.toolName, args: (chunk.input ?? {}) as Record<string, unknown> });
            break;
          case 'finish':
-           if (chunk.totalUsage) {
-             usage.input += chunk.totalUsage.inputTokens ?? 0;
-             usage.output += chunk.totalUsage.outputTokens ?? 0;
-             this.tokenEconomy?.track(chunk.totalUsage.inputTokens ?? 0, chunk.totalUsage.outputTokens ?? 0);
+           if (chunk.usage) {
+             usage.input += chunk.usage.inputTokens;
+             usage.output += chunk.usage.outputTokens;
+             this.tokenEconomy?.track(chunk.usage.inputTokens, chunk.usage.outputTokens);
            }
            break;
          case 'error':
-           const msg = chunk.error instanceof Error ? chunk.error.message : String(chunk.error ?? 'unknown error');
-           modelSpan.error(new Error(msg));
-           yield this.emit({ type: 'error', message: msg });
+           modelSpan.error(new Error(chunk.message));
+           yield this.emit({ type: 'error', message: chunk.message });
            break;
        }
      }
    } catch (err) { ... }
```

- [ ] **Step 2: Update `tryCompact()`**

```diff
  private async *tryCompact(messages, signal) {
-   const result = await this.compactor.compactIfNeeded(messages, this.agent.languageModel, signal);
+   const result = await this.compactor.compactIfNeeded(messages, this.agent.modelClient, signal);
  }
```

- [ ] **Step 3: Verify typecheck**

Run: `cd packages/agent && pnpm typecheck`
Expected: errors only in `context-compactor.ts` and `vico.ts` (will fix next)

- [ ] **Step 4: Commit**

```bash
git add packages/agent/src/agent-loop/agent-loop.ts
git commit -m "refactor(agent-loop): replace streamText with ModelClient.stream()"
```

---

### Task 9: Replace `streamText` in `context-compactor.ts`

**Files:**
- Modify: `packages/agent/src/agent-loop/context-compactor.ts`

- [ ] **Step 1: Update imports and method signature**

```diff
- import { streamText } from 'ai';
- import type { LanguageModel } from 'ai';
+ import type { ModelClient } from '../model/model-client.js';

  export class ContextCompactor {
-   async compactIfNeeded(items: ModelMessage[], languageModel: LanguageModel, signal: AbortSignal): Promise<...> {
+   async compactIfNeeded(items: ModelMessage[], modelClient: ModelClient, signal: AbortSignal): Promise<...> {
      // ...
      try {
-       const result = streamText({
+       const { stream } = await modelClient.stream({
          system: 'Summarize the following conversation concisely. Keep key decisions, facts, and action items.',
-         model: languageModel,
-         messages: head as any,
+         messages: head,
          abortSignal: signal,
        });
        let text = '';
-       for await (const chunk of result.fullStream) {
+       for await (const chunk of stream) {
          if (chunk.type === 'text-delta') {
-           text += chunk.text;
+           text += chunk.delta;
          }
        }
      } catch { ... }
    }
```

- [ ] **Step 2: Verify typecheck**

Run: `cd packages/agent && pnpm typecheck`
Expected: errors only in `vico.ts` (will fix next)

- [ ] **Step 3: Commit**

```bash
git add packages/agent/src/agent-loop/context-compactor.ts
git commit -m "refactor(context-compactor): replace streamText with ModelClient.stream()"
```

---

### Task 10: Replace `createUIMessageStreamResponse` in `turn-stream.ts`

**Files:**
- Modify: `packages/agent/src/stream/turn-stream.ts`

- [ ] **Step 1: Update imports and type references**

```diff
- import { createUIMessageStreamResponse, type UIMessageChunk } from 'ai';
+ import { createSSEResponse } from './sse.js';
+ import type { UIStreamChunk } from './types.js';

  export async function turnEventsToAISDK(
    generator: AsyncGenerator<TurnEvent, TurnResult>,
-   options?: { onFinish?: (finish: Extract<UIMessageChunk, { type: 'finish' }>, fullText: string) => void | Promise<void> },
+   options?: { onFinish?: (finish: Extract<UIStreamChunk, { type: 'finish' }>, fullText: string) => void | Promise<void> },
  ): Promise<Response> {
    let fullText = '';

-   const stream = new ReadableStream<UIMessageChunk>({
+   const stream = new ReadableStream<UIStreamChunk>({
      async start(controller) {
-       const enqueue = (chunk: UIMessageChunk) => {
+       const enqueue = (chunk: UIStreamChunk) => {
          controller.enqueue(chunk);
        };
        // ... (rest of body unchanged, just type annotation changes)
      },
    });

-   const response = createUIMessageStreamResponse({
+   const response = createSSEResponse(
      stream,
-     headers: {
+     {
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
-   });
+   );
  }
```

Note: The `finish` chunk `Extract<UIStreamChunk, { type: 'finish' }>` needs `finishReason` which exists in our `UIStreamChunk` definition.

- [ ] **Step 2: Adjust `finish` chunk type usage**

Check the `onFinish` callback: currently `finish.finishReason` is used. In `UIStreamChunk` the finish type has `finishReason?: 'stop' | ...`. This should work as-is.

- [ ] **Step 3: Verify typecheck**

Run: `cd packages/agent && pnpm typecheck`
Expected: errors only in `vico.ts` (will fix next task)

- [ ] **Step 4: Commit**

```bash
git add packages/agent/src/stream/turn-stream.ts
git commit -m "refactor(turn-stream): replace createUIMessageStreamResponse with createSSEResponse"
```

---

### Task 11: Update `vico.ts` container

**Files:**
- Modify: `packages/agent/src/container/vico.ts`

- [ ] **Step 1: Update all `LanguageModel` references**

```diff
- import type {LanguageModel} from 'ai';
+ import type {LanguageModelV3} from '@ai-sdk/provider';

- export type LanguageModelFactory = (ref: ModelRef) => LanguageModel;
+ export type LanguageModelFactory = (ref: ModelRef) => LanguageModelV3;

  /** Vico 配置选项 */
  export interface VicoOptions {
-   /** LanguageModel 工厂（不传则使用内置 createLanguageModel） */
+   /** LanguageModel factory */
    languageModelFactory?: LanguageModelFactory;
  }

  export class Vico {
-   private readonly languageModelFactory: LanguageModelFactory;
+   private readonly languageModelFactory: LanguageModelFactory;

    async createAgent(config: AgentConfig): Promise<Agent> {
-     const languageModel = this.languageModelFactory(config.model);
-     const agent = await this.buildAgent(config, languageModel);
+     const model = this.languageModelFactory(config.model);
+     const agent = await this.buildAgent(config, model);
      this.runtime.register(agent);
      return agent;
    }

-   private async buildAgent(config: AgentConfig, languageModel: LanguageModel): Promise<Agent> {
+   private async buildAgent(config: AgentConfig, model: LanguageModelV3): Promise<Agent> {
      // ...
      const agent = new Agent({
        config,
-       languageModel,
+       model,
        skills, tools, memory, thread,
      });
```

- [ ] **Step 2: Verify typecheck**

Run: `cd packages/agent && pnpm typecheck`
Expected: PASS (all `ai` imports in `@vico/agent` should be gone now)

- [ ] **Step 3: Commit**

```bash
git add packages/agent/src/container/vico.ts
git commit -m "refactor(vico): switch from LanguageModel to LanguageModelV3"
```

---

### Task 12: Update server-side references + delete `toAISDKTools`

**Files:**
- Modify: `vico/server/src/chat/chat.ts`
- Modify: `packages/agent/src/tool/utils.ts`
- Modify: `packages/agent/package.json`
- Modify: `packages/agent/src/index.ts`

- [ ] **Step 1: Update server `chat.ts`**

Check the file for `languageModel` references and rename to `model`.

Run: `grep -n 'languageModel' vico/server/src/chat/chat.ts`

If the file passes `languageModel` to `new Agent({...})` or similar, update:

```diff
- languageModel: model,
+ model: model,
```

- [ ] **Step 2: Delete `toAISDKTools` from `tool/utils.ts`**

Remove the `toAISDKTools` function. If this was the only export, delete the file.

- [ ] **Step 3: Update `package.json`**

```diff
  "dependencies": {
    "@ai-sdk/provider": "^3.0.10",
    "@ai-sdk/provider-utils": "^4.0.30",
+   "@ai-sdk/anthropic": "^3.0.0",
+   "@ai-sdk/openai": "^3.0.0",
    "@vico/rag": "workspace:*",
  }
```

Note: `@ai-sdk/anthropic` and `@ai-sdk/openai` were likely hoisted from the root/server. Check and add if needed.

- [ ] **Step 4: Update `index.ts` exports**

Add exports for new public types:

```typescript
export { ModelClient } from './model/model-client.js';
export type { ModelStreamChunk, ModelCallOptions, ModelStreamResult, ModelUsage, ToolDescriptor } from './model/types.js';
export type { UIStreamChunk } from './stream/types.js';
export { createSSEResponse } from './stream/sse.js';
```

- [ ] **Step 5: Verify typecheck**

Run: `cd packages/agent && pnpm typecheck && cd ../.. && pnpm typecheck`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/agent/src/tool/utils.ts packages/agent/package.json packages/agent/src/index.ts vico/server/src/chat/chat.ts
git commit -m "chore: delete toAISDKTools, update exports and dependencies"
```

---

### Task 13: Update test mocks

**Files:**
- Modify: `packages/agent/src/__tests__/agent-loop.test.ts`
- Modify: `packages/agent/src/__tests__/agent-runtime.test.ts`

- [ ] **Step 1: Update mock LanguageModel in test files**

Replace in both test files:

```diff
- import type { LanguageModel } from 'ai';
- const mockLM: LanguageModel = 'mock-model' as unknown as LanguageModel;
+ import type { LanguageModelV3 } from '@ai-sdk/provider';
+ import { vi } from 'vitest';
+ const mockLM: LanguageModelV3 = {
+   specificationVersion: 'v3' as const,
+   provider: 'mock',
+   modelId: 'mock-model',
+   supportedUrls: {},
+   doGenerate: vi.fn().mockRejectedValue(new Error('not implemented')),
+   doStream: vi.fn().mockResolvedValue({
+     stream: new ReadableStream({
+       start(controller) {
+         controller.enqueue({ type: 'text-delta', id: 't1', delta: 'mock response' });
+         controller.enqueue({
+           type: 'finish',
+           finishReason: { unified: 'stop', raw: 'stop' },
+           usage: {
+             inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
+             outputTokens: { total: 5, text: 5, reasoning: 0 },
+           },
+         });
+         controller.close();
+       },
+     }),
+   }),
+ };
```

- [ ] **Step 2: Also update Agent constructor calls in tests**

```diff
  new Agent({
    config,
-   languageModel: mockLM,
+   model: mockLM,
    // ...
  })
```

- [ ] **Step 3: Run all tests**

Run: `cd packages/agent && pnpm test -- --run`
Expected: all existing tests PASS (or need minor adjustment for the `delta` vs `text` field name change)

- [ ] **Step 4: Commit**

```bash
git add packages/agent/src/__tests__/
git commit -m "test: update mocks to LanguageModelV3 with ModelClient"
```

---

### Task 14: Final verification — build + full typecheck

- [ ] **Step 1: Run full typecheck**

Run: `cd /Users/taosikai/www/js/vico && pnpm typecheck`
Expected: PASS across all packages

- [ ] **Step 2: Run all tests**

Run: `cd /Users/taosikai/www/js/vico && pnpm test`
Expected: all tests PASS

- [ ] **Step 3: Verify `ai` package is no longer imported in `@vico/agent`**

Run: `grep -r "from 'ai'" packages/agent/src/ --include='*.ts'`
Expected: no results (or only in comments)

- [ ] **Step 4: Commit**

```bash
git commit -m "chore: final verification — all typechecks and tests pass"
```

---

## Task Dependency Graph

```
Task 1 (types)
  ├─ Task 2 (prompt-converter)
  ├─ Task 3 (tool-converter)
  ├─ Task 6 (SSE types)
  └─ Task 4 (stream-processor)
       └─ Task 5 (ModelClient)
            ├─ Task 7 (factory + Agent)
            │    ├─ Task 8 (agent-loop)
            │    ├─ Task 9 (context-compactor)
            │    └─ Task 11 (vico)
            ├─ Task 6 ── Task 10 (turn-stream)
            └─ Task 12 (cleanup)
                 └─ Task 13 (test mocks)
                      └─ Task 14 (final verify)
```

Tasks 2, 3, 4, 6 can be done in parallel once Task 1 is complete.
