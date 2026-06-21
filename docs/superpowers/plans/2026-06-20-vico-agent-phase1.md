# @vico/agent Phase 1 — 框架基础骨架

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 搭建 `@vico/agent` 独立包骨架，定义全部端口接口 + 实现 AgentRuntime/AgentLoop/ModelClient/PromptAssembler/Observable/Hook 核心模块，可独立编译和测试。

**Architecture:** Ports & Adapters 模式，按领域组织目录（非按分层）。AgentLoop 是核心循环引擎，通过端口接口组装所有外部依赖，支持 mock 测试。

**Tech Stack:** TypeScript 5.6+ ESM、Zod 4.x（合约校验）、AI SDK v6（LLM 适配）、mitt 3.x（事件总线）、Vitest（测试）

## Global Constraints

- 包 `@vico/agent` 为独立 npm 包，不依赖 `@vico/server`，不依赖 Mastra
- 接口使用 Zod schema 校验入参，类型通过 `z.infer` 派生
- ESM 模块，导入带 `.js` 扩展名
- 循环依赖零容忍：agent-loop 可依赖所有端口，端口之间互不依赖
- 所有端口是纯 TS 接口（抽象），不包含实现逻辑
- Node.js >= 22

---

## File Structure

```
packages/agent/
├── package.json
├── tsconfig.json
└── src/
    ├── index.ts                    # 统一导出（public API）
    ├── contracts/                  # Zod Schema 定义
    │   ├── agent.ts                # AgentConfig
    │   ├── tool.ts                 # ToolSpec, ToolCall, ToolResult
    │   ├── memory.ts               # MemoryRecord
    │   └── events.ts               # SSEEvent, SpanType
    ├── agent-runtime/              # Agent 运行时容器
    │   └── agent-runtime.ts        # 端口接口 + 实现
    ├── agent-loop/                 # Agent 循环引擎
    │   ├── agent-loop.ts           # 端口接口 + 实现
    │   └── context-compactor.ts    # 端口接口（Phase 1 仅接口）
    ├── model/                      # 模型抽象层
    │   ├── model-client.ts         # 端口接口
    │   └── ai-sdk-adapter.ts       # AI SDK 适配器实现
    ├── prompt/                     # Prompt 拼装
    │   └── assembler.ts            # 端口接口 + 实现
    ├── tool/                       # 工具系统
    │   └── tool-host.ts            # 端口接口（Phase 1 仅接口）
    ├── skill/                      # Skill 系统
    │   └── skill-loader.ts         # 端口接口（Phase 1 仅接口）
    ├── memory/                     # 记忆系统
    │   └── memory-store.ts         # 端口接口（Phase 1 仅接口）
    ├── session/                    # 会话/存储
    │   └── session-store.ts        # 端口接口（Phase 1 仅接口）
    ├── hook/                       # 生命周期 Hook
    │   ├── hook-types.ts           # HookEvent, HookResult, HookRunner 接口
    │   └── hook-runner.ts          # HookRunner 实现
    └── observable/                 # 可观测性
        ├── event-recorder.ts       # 端口接口 + mitt 实现
        └── span-tracker.ts         # 端口接口 + 实现
```

---

### Task 1: Package Scaffold

**Files:**
- Create: `packages/agent/package.json`
- Create: `packages/agent/tsconfig.json`

**Interfaces:**
- Produces: npm package `@vico/agent` (private), ESM, TypeScript 5.6+

- [ ] **Step 1: Create package.json**

```json
{
  "name": "@vico/agent",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts",
    "./contracts": "./src/contracts/agent.ts"
  },
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "build": "tsc",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "mitt": "^3.0.1",
    "zod": "^4.4.3"
  },
  "peerDependencies": {
    "ai": "^6.0.0"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "typescript": "^5.6.0",
    "vitest": "^4.1.8"
  }
}
```

- [ ] **Step 2: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 3: Install dependencies and verify compilation**

```bash
cd vico/agent && pnpm install && npx tsc --noEmit --project tsconfig.json
```
Expected: no output (no errors), even with empty `src/`.

- [ ] **Step 4: Commit**

```bash
git add vico/agent/package.json vico/agent/tsconfig.json
git commit -m "feat(agent): scaffold @vico/agent package"
```

---

### Task 2: Contracts — Zod Schema

**Files:**
- Create: `packages/agent/src/contracts/agent.ts`
- Create: `packages/agent/src/contracts/tool.ts`
- Create: `packages/agent/src/contracts/memory.ts`
- Create: `packages/agent/src/contracts/events.ts`

**Interfaces:**
- Produces:
  - `AgentConfig` type (inferred from `AgentConfigSchema`)
  - `ToolSpec`, `ToolCall`, `ToolResult` types
  - `MemoryRecord` type
  - `SSEEvent`, `SpanType` types

- [ ] **Step 1: Write AgentConfig schema**

```typescript
// src/contracts/agent.ts
import { z } from 'zod';

/** 模型引用 */
export const ModelRefSchema = z.object({
  provider: z.string().min(1),
  model: z.string().min(1),
  baseUrl: z.string().url().optional(),
  apiKey: z.string().optional(),
});

/** Agent 配置（从 DB 加载） */
export const AgentConfigSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string(),
  name: z.string().min(1).max(128),
  systemPrompt: z.string().default(''),
  model: ModelRefSchema,
  temperature: z.number().min(0).max(2).default(0.7),
  maxTokens: z.number().int().positive().default(4096),
  maxSteps: z.number().int().min(1).max(100).default(10),
  allowedToolNames: z.array(z.string()).optional(),
  skillIds: z.array(z.string()).optional(),
});

export type AgentConfig = z.infer<typeof AgentConfigSchema>;
export type ModelRef = z.infer<typeof ModelRefSchema>;
```

- [ ] **Step 2: Write Tool contracts**

```typescript
// src/contracts/tool.ts
import { z } from 'zod';

/** 工具审批策略 */
export const ToolPolicySchema = z.enum(['auto', 'on-request', 'suggest', 'never']);
export type ToolPolicy = z.infer<typeof ToolPolicySchema>;

/** 工具类别 */
export const ToolKindSchema = z.enum(['readonly', 'command', 'file_change', 'delegate']);
export type ToolKind = z.infer<typeof ToolKindSchema>;

/** 工具规格定义（发给 LLM 的 tool description） */
export const ToolSpecSchema = z.object({
  name: z.string().min(1),
  description: z.string(),
  inputSchema: z.record(z.unknown()),
  policy: ToolPolicySchema.default('auto'),
  kind: ToolKindSchema.default('readonly'),
});
export type ToolSpec = z.infer<typeof ToolSpecSchema>;

/** LLM 返回的工具调用 */
export const ToolCallSchema = z.object({
  id: z.string(),
  name: z.string(),
  args: z.record(z.unknown()),
});
export type ToolCall = z.infer<typeof ToolCallSchema>;

/** 工具执行结果 */
export const ToolResultSchema = z.object({
  callId: z.string(),
  name: z.string(),
  status: z.enum(['success', 'error']),
  output: z.unknown(),
  error: z.string().optional(),
});
export type ToolResult = z.infer<typeof ToolResultSchema>;
```

- [ ] **Step 3: Write Memory contracts**

```typescript
// src/contracts/memory.ts
import { z } from 'zod';

export const MemoryRecordSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string(),
  threadId: z.string().optional(),
  content: z.string(),
  embedding: z.array(z.number()).optional(),
  metadata: z.record(z.unknown()).optional(),
  createdAt: z.number(),
});
export type MemoryRecord = z.infer<typeof MemoryRecordSchema>;
```

- [ ] **Step 4: Write Event contracts**

```typescript
// src/contracts/events.ts
import { z } from 'zod';

export const SpanTypeSchema = z.enum([
  'agent_run',
  'model_step',
  'tool_call',
  'memory_retrieval',
  'rag_search',
  'skill_activation',
  'context_compaction',
]);
export type SpanType = z.infer<typeof SpanTypeSchema>;

export const SSEEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text_delta'), content: z.string() }),
  z.object({ type: z.literal('reasoning_delta'), content: z.string() }),
  z.object({ type: z.literal('tool_call_start'), id: z.string(), name: z.string() }),
  z.object({ type: z.literal('tool_call_delta'), id: z.string(), args: z.string() }),
  z.object({ type: z.literal('tool_result'), id: z.string(), name: z.string(), status: z.enum(['success', 'error']), output: z.unknown() }),
  z.object({ type: z.literal('step_start'), step: z.number() }),
  z.object({ type: z.literal('step_end'), step: z.number() }),
  z.object({ type: z.literal('compacted'), removedTokens: z.number() }),
  z.object({ type: z.literal('approval_request'), callId: z.string(), name: z.string(), args: z.record(z.unknown()) }),
  z.object({ type: z.literal('done'), usage: z.object({ input: z.number(), output: z.number() }).optional() }),
  z.object({ type: z.literal('error'), message: z.string() }),
]);
export type SSEEvent = z.infer<typeof SSEEventSchema>;
```

- [ ] **Step 5: Verify TypeScript compilation**

```bash
cd vico/agent && npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add vico/agent/src/contracts/
git commit -m "feat(agent): define Zod contracts for AgentConfig, ToolDef, SSEEvent"
```

---

### Task 3: Port Interfaces — ModelClient, PromptAssembler, ToolHost

**Files:**
- Create: `packages/agent/src/model/model-client.ts`
- Create: `packages/agent/src/prompt/assembler.ts`
- Create: `packages/agent/src/tool/tool-host.ts`

**Interfaces:**
- Produces:
  - `ModelClient` interface — `stream(request: ModelRequest): AsyncIterable<ModelStreamChunk>`
  - `ModelRequest`, `ModelMessage`, `ModelStreamChunk` types
  - `PromptAssembler` interface — `assemble(ctx: PromptContext): ModelRequest`
  - `PromptContext` type
  - `ToolHost` interface — `listTools()`, `execute()`, `executeBatch()`
  - `ToolExecutionContext` type

- [ ] **Step 1: Write ModelClient port**

```typescript
// src/model/model-client.ts
import type { ToolSpec } from '../contracts/tool.js';

/** 消息角色 */
export type MessageRole = 'system' | 'user' | 'assistant' | 'tool';

/** 标准化消息格式 */
export interface ModelMessage {
  role: MessageRole;
  content: string;
  toolCallId?: string;
  toolCalls?: { id: string; name: string; args: Record<string, unknown> }[];
}

/** LLM 请求 */
export interface ModelRequest {
  system?: string;
  messages: ModelMessage[];
  tools: ToolSpec[];
  maxTokens?: number;
  temperature?: number;
  abortSignal: AbortSignal;
}

/** 标准化流式块 — 屏蔽 AI SDK 版本差异 */
export type ModelStreamChunk =
  | { type: 'text_delta'; content: string }
  | { type: 'reasoning_delta'; content: string }
  | { type: 'tool_call_delta'; id: string; name: string; args: string }
  | { type: 'tool_call_complete'; id: string; name: string; args: Record<string, unknown> }
  | { type: 'usage'; input: number; output: number }
  | { type: 'completed'; finishReason: string }
  | { type: 'error'; message: string };

/** 模型客户端端口 — 封装 LLM 调用 */
export interface ModelClient {
  readonly provider: string;
  readonly model: string;

  /** 流式调用 LLM，返回标准化 chunk 迭代器 */
  stream(request: ModelRequest): AsyncIterable<ModelStreamChunk>;
}
```

- [ ] **Step 2: Write PromptAssembler port**

```typescript
// src/prompt/assembler.ts
import type { AgentConfig } from '../contracts/agent.js';
import type { ModelRequest, ModelMessage } from '../model/model-client.js';
import type { ToolSpec } from '../contracts/tool.js';
import type { MemoryRecord } from '../contracts/memory.js';

/** Skill 目录项（元数据，非完整指令） */
export interface SkillCatalogEntry {
  name: string;
  description: string;
  location: string;
}

/** RAG 检索结果 */
export interface RagChunk {
  content: string;
  score: number;
  source: string;
}

/** Prompt 拼装上下文 */
export interface PromptContext {
  agent: AgentConfig;
  skillCatalog: SkillCatalogEntry[];
  memoryItems: MemoryRecord[];
  ragResults: RagChunk[];
  history: ModelMessage[];
  tools: ToolSpec[];
  dynamicInstructions: string[];
}

/** 系统提示词拼装器端口 */
export interface PromptAssembler {
  assemble(context: PromptContext): ModelRequest;
}
```

- [ ] **Step 3: Write ToolHost port**

```typescript
// src/tool/tool-host.ts
import type { ToolSpec, ToolCall, ToolResult, ToolPolicy } from '../contracts/tool.js';
import type { HookRunner } from '../hook/hook-types.js';

/** 工具执行上下文 */
export interface ToolExecutionContext {
  tenantId: string;
  userId: string;
  agentId: string;
  threadId: string;
  workspace: string;
  awaitApproval: (call: ToolCall) => Promise<ApprovalDecision>;
  hooks: HookRunner[];
  signal: AbortSignal;
}

export interface ApprovalDecision {
  approved: boolean;
  reason?: string;
}

/** 工具系统端口 */
export interface ToolHost {
  listTools(context: ToolExecutionContext): Promise<ToolSpec[]>;
  execute(call: ToolCall, context: ToolExecutionContext): Promise<ToolResult>;
  executeBatch(calls: ToolCall[], context: ToolExecutionContext): Promise<ToolResult[]>;
}
```

- [ ] **Step 4: Verify TypeScript compilation**

```bash
cd vico/agent && npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add vico/agent/src/model/ vico/agent/src/prompt/ vico/agent/src/tool/
git commit -m "feat(agent): define ModelClient, PromptAssembler, ToolHost port interfaces"
```

---

### Task 4: Port Interfaces — MemoryStore, SkillLoader, SessionStore, ContextCompactor, Hook, Observable

**Files:**
- Create: `packages/agent/src/memory/memory-store.ts`
- Create: `packages/agent/src/skill/skill-loader.ts`
- Create: `packages/agent/src/session/session-store.ts`
- Create: `packages/agent/src/agent-loop/context-compactor.ts`
- Create: `packages/agent/src/hook/hook-types.ts`
- Create: `packages/agent/src/observable/event-recorder.ts`
- Create: `packages/agent/src/observable/span-tracker.ts`

**Interfaces:**
- Produces:
  - `MemoryStore` interface
  - `SkillLoader` + `Skill` interfaces
  - `SessionStore` interface
  - `ContextCompactor` interface
  - `HookRunner` interface + `HookEvent`, `HookResult` types
  - `EventRecorder` interface + `SSEEvent` re-export
  - `SpanTracker` + `Span` interfaces

- [ ] **Step 1: Write MemoryStore port**

```typescript
// src/memory/memory-store.ts
import type { ModelMessage } from '../model/model-client.js';
import type { MemoryRecord } from '../contracts/memory.js';
import type { RagChunk } from '../prompt/assembler.js';

export interface MemoryStore {
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
}
```

- [ ] **Step 2: Write SkillLoader port**

```typescript
// src/skill/skill-loader.ts

export interface Skill {
  name: string;
  description: string;
  instructions: string;
  path: string;
  source: 'local' | 'external' | 'managed';
  license?: string;
  compatibility?: string;
  userInvocable: boolean;
  references: string[];
  scripts: string[];
  assets: string[];
  metadata?: Record<string, string>;
}

export interface SkillLoader {
  discover(roots: string[]): Promise<Skill[]>;
  load(skillPath: string): Promise<Skill>;
  refresh(roots: string[]): Promise<void>;
}
```

- [ ] **Step 3: Write SessionStore port**

```typescript
// src/session/session-store.ts
import type { ModelMessage } from '../model/model-client.js';

export interface Thread {
  id: string;
  agentId: string;
  tenantId: string;
  title?: string;
  createdAt: number;
  updatedAt: number;
}

export interface Turn {
  id: string;
  threadId: string;
  status: 'running' | 'completed' | 'failed' | 'aborted';
  steps: number;
  createdAt: number;
}

export interface ConversationEntry {
  id: string;
  threadId: string;
  turnId: string;
  role: string;
  content: string;
  toolCalls?: unknown;
  toolResults?: unknown;
  createdAt: number;
}

export interface SessionStore {
  /** Thread 操作 */
  createThread(agentId: string, tenantId: string, title?: string): Promise<Thread>;
  getThread(threadId: string): Promise<Thread | undefined>;
  listThreads(tenantId: string, agentId?: string): Promise<Thread[]>;

  /** Turn 操作 */
  createTurn(threadId: string): Promise<Turn>;
  updateTurn(turnId: string, patch: Partial<Turn>): Promise<void>;
  getTurn(turnId: string): Promise<Turn | undefined>;

  /** 消息操作 */
  appendEntry(entry: Omit<ConversationEntry, 'id' | 'createdAt'>): Promise<ConversationEntry>;
  getEntries(threadId: string, limit?: number): Promise<ConversationEntry[]>;
}
```

- [ ] **Step 4: Write ContextCompactor port**

```typescript
// src/agent-loop/context-compactor.ts
import type { ModelMessage } from '../model/model-client.js';
import type { ModelClient } from '../model/model-client.js';

export interface ContextCompactor {
  compactIfNeeded(
    items: ModelMessage[],
    model: ModelClient,
    signal: AbortSignal,
  ): Promise<{
    compacted: ModelMessage[];
    wasCompacted: boolean;
    removedTokens: number;
  }>;
}
```

- [ ] **Step 5: Write Hook port**

```typescript
// src/hook/hook-types.ts

export type HookEvent =
  | 'turn:start'
  | 'turn:end'
  | 'tool:before'
  | 'tool:after'
  | 'prompt:submit'
  | 'compact:before'
  | 'compact:after';

export interface HookResult {
  action: 'continue' | 'modify' | 'deny';
  modifiedData?: unknown;
  message?: string;
}

export interface HookRunner {
  event: HookEvent;
  run(data: unknown): Promise<HookResult>;
}
```

- [ ] **Step 6: Write Observable ports**

```typescript
// src/observable/event-recorder.ts
import type { SSEEvent } from '../contracts/events.js';

/** SSE 事件广播器端口 */
export interface EventRecorder {
  emit(event: SSEEvent): void;
  on(event: string, handler: (data: unknown) => void): void;
  off(event: string, handler: (data: unknown) => void): void;
}
```

```typescript
// src/observable/span-tracker.ts
import type { SpanType } from '../contracts/events.js';

export interface Span {
  readonly id: string;
  end(result?: Record<string, unknown>): void;
  error(error: Error): void;
}

export interface SpanTracker {
  startSpan(type: SpanType, metadata?: Record<string, unknown>): Span;
}
```

- [ ] **Step 7: Verify TypeScript compilation**

```bash
cd vico/agent && npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add vico/agent/src/memory/ vico/agent/src/skill/ vico/agent/src/session/ vico/agent/src/agent-loop/ vico/agent/src/hook/ vico/agent/src/observable/
git commit -m "feat(agent): define MemoryStore, SkillLoader, SessionStore, Hook, Observable ports"
```

---

### Task 5: Model Adapter — AISDKModelClient

**Files:**
- Create: `packages/agent/src/model/ai-sdk-adapter.ts`

**Interfaces:**
- Consumes: `ModelClient` from `model/model-client.ts`, `ModelStreamChunk` from `model/model-client.ts`
- Produces: `AISDKModelClient` class implementing `ModelClient`

- [ ] **Step 1: Write AISDKModelClient**

```typescript
// src/model/ai-sdk-adapter.ts
import type { LanguageModel } from 'ai';
import { streamText, type CoreTool } from 'ai';
import type {
  ModelClient,
  ModelMessage,
  ModelRequest,
  ModelStreamChunk,
} from './model-client.js';
import type { ToolSpec } from '../contracts/tool.js';

/** 将框架 ToolSpec 转为 AI SDK CoreTool 格式 */
function toAISDKTools(tools: ToolSpec[]): Record<string, CoreTool> {
  const result: Record<string, CoreTool> = {};
  for (const tool of tools) {
    result[tool.name] = {
      description: tool.description,
      parameters: tool.inputSchema as CoreTool['parameters'],
    };
  }
  return result;
}

/** AISDKModelClient — 基于 AI SDK streamText 的模型适配器 */
export class AISDKModelClient implements ModelClient {
  constructor(
    private languageModel: LanguageModel,
    public readonly provider: string,
    public readonly model: string,
  ) {}

  async *stream(request: ModelRequest): AsyncIterable<ModelStreamChunk> {
    try {
      const result = streamText({
        model: this.languageModel,
        system: request.system,
        messages: request.messages as any, // AI SDK v6 接受类似格式
        tools: toAISDKTools(request.tools),
        maxTokens: request.maxTokens,
        temperature: request.temperature,
        abortSignal: request.abortSignal,
      });

      let usageEmitted = false;

      for await (const chunk of result.fullStream) {
        switch (chunk.type) {
          case 'text-delta':
            yield { type: 'text_delta', content: (chunk as any).textDelta ?? '' };
            break;
          case 'reasoning-delta':
            yield { type: 'reasoning_delta', content: (chunk as any).textDelta ?? '' };
            break;
          case 'tool-call':
            yield {
              type: 'tool_call_complete',
              id: (chunk as any).toolCallId ?? '',
              name: (chunk as any).toolName ?? '',
              args: (chunk as any).args ?? {},
            };
            break;
          case 'finish':
            if (!usageEmitted && (chunk as any).usage) {
              const u = (chunk as any).usage;
              yield { type: 'usage', input: u.promptTokens ?? 0, output: u.completionTokens ?? 0 };
              usageEmitted = true;
            }
            yield { type: 'completed', finishReason: (chunk as any).finishReason ?? 'stop' };
            break;
          case 'error':
            yield { type: 'error', message: (chunk as any).error ?? 'unknown error' };
            break;
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      yield { type: 'error', message };
    }
  }
}
```

- [ ] **Step 2: Verify TypeScript compilation**

```bash
cd vico/agent && npx tsc --noEmit
```
Expected: no errors. (If AI SDK v6 chunk types differ, adjust mapping — the port contract is the `ModelStreamChunk` union, not the internal mapping.)

- [ ] **Step 3: Commit**

```bash
git add vico/agent/src/model/ai-sdk-adapter.ts
git commit -m "feat(agent): implement AISDKModelClient adapter wrapping ai v6 streamText"
```

---

### Task 6: PromptAssembler Implementation

**Files:**
- Create: `packages/agent/src/prompt/assembler.ts` (add implementation to existing port file, or rename port to keep interface separate)

> **Design decision:** Since the port and implementation for PromptAssembler are simple, put them in the same file. The port is the interface; the implementation is a class.

- Modify: `packages/agent/src/prompt/assembler.ts` — add `PromptAssemblerImpl` class

**Interfaces:**
- Consumes: `PromptAssembler`, `PromptContext` (already defined in file)
- Produces: `PromptAssemblerImpl` class

- [ ] **Step 1: Add PromptAssemblerImpl to assembler.ts**

Read the existing `src/prompt/assembler.ts`, then replace it with:

```typescript
// src/prompt/assembler.ts
import type { AgentConfig } from '../contracts/agent.js';
import type { ModelRequest, ModelMessage } from '../model/model-client.js';
import type { ToolSpec } from '../contracts/tool.js';
import type { MemoryRecord } from '../contracts/memory.js';

/** Skill 目录项（元数据，非完整指令） */
export interface SkillCatalogEntry {
  name: string;
  description: string;
  location: string;
}

/** RAG 检索结果 */
export interface RagChunk {
  content: string;
  score: number;
  source: string;
}

/** Prompt 拼装上下文 */
export interface PromptContext {
  agent: AgentConfig;
  skillCatalog: SkillCatalogEntry[];
  memoryItems: MemoryRecord[];
  ragResults: RagChunk[];
  history: ModelMessage[];
  tools: ToolSpec[];
  dynamicInstructions: string[];
}

/** 系统提示词拼装器端口 */
export interface PromptAssembler {
  assemble(context: PromptContext): ModelRequest;
}

/** PromptAssembler 默认实现 */
export class PromptAssemblerImpl implements PromptAssembler {
  assemble(context: PromptContext): ModelRequest {
    const messages: ModelMessage[] = [];
    const { agent, skillCatalog, memoryItems, ragResults, history, tools, dynamicInstructions } =
      context;

    // 1. 系统提示词（不可变前缀，可被 Prompt 缓存复用）
    let systemPrompt = agent.systemPrompt;

    // 2. Skill 目录 — 折叠进 system prompt 以利用缓存
    if (skillCatalog.length > 0) {
      const skillList = skillCatalog
        .map((s) => `- ${s.name}: ${s.description}`)
        .join('\n');
      systemPrompt += `\n\n<available_skills>\n${skillList}\n</available_skills>`;
    }

    // 3. 对话历史
    messages.push(...history);

    // 4. 动态上下文指令（放在 history 之后，避免破坏缓存前缀）
    if (memoryItems.length > 0) {
      const memText = memoryItems.map((m) => `- ${m.content}`).join('\n');
      messages.push({ role: 'system', content: `Relevant memories:\n${memText}` });
    }

    if (ragResults.length > 0) {
      const ragText = ragResults.map((r) => `[${r.source}] ${r.content}`).join('\n');
      messages.push({ role: 'system', content: `Relevant knowledge:\n${ragText}` });
    }

    if (dynamicInstructions.length > 0) {
      messages.push({ role: 'system', content: dynamicInstructions.join('\n') });
    }

    return {
      system: systemPrompt,
      messages,
      tools,
      maxTokens: agent.maxTokens,
      temperature: agent.temperature,
      abortSignal: new AbortController().signal, // caller overrides
    };
  }
}
```

- [ ] **Step 2: Verify TypeScript compilation**

```bash
cd vico/agent && npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add vico/agent/src/prompt/assembler.ts
git commit -m "feat(agent): implement PromptAssembler with cache-friendly assembly order"
```

---

### Task 7: Observable — EventRecorder + SpanTracker

**Files:**
- Create: `packages/agent/src/observable/event-recorder.ts` — replace interface-only file with implementation
- Create: `packages/agent/src/observable/span-tracker.ts` — replace interface-only file with implementation

**Interfaces:**
- Consumes: `EventRecorder`, `SpanTracker` ports (already defined), `mitt` for event bus
- Produces: `MittEventRecorder`, `InMemorySpanTracker` classes

- [ ] **Step 1: Implement MittEventRecorder**

```typescript
// src/observable/event-recorder.ts
import mitt, { type Emitter } from 'mitt';
import type { SSEEvent } from '../contracts/events.js';

/** SSE 事件广播器端口 */
export interface EventRecorder {
  emit(event: SSEEvent): void;
  on(event: string, handler: (data: unknown) => void): void;
  off(event: string, handler: (data: unknown) => void): void;
}

/** 基于 mitt 的 EventRecorder 实现 */
export class MittEventRecorder implements EventRecorder {
  private emitter: Emitter<Record<string, unknown>>;

  constructor() {
    this.emitter = mitt<Record<string, unknown>>();
  }

  emit(event: SSEEvent): void {
    this.emitter.emit(event.type, event);
    this.emitter.emit('*', event);
  }

  on(event: string, handler: (data: unknown) => void): void {
    this.emitter.on(event, handler);
  }

  off(event: string, handler: (data: unknown) => void): void {
    this.emitter.off(event, handler);
  }
}
```

- [ ] **Step 2: Implement InMemorySpanTracker**

```typescript
// src/observable/span-tracker.ts
import type { SpanType } from '../contracts/events.js';
import { randomUUID } from 'node:crypto';

export interface Span {
  readonly id: string;
  end(result?: Record<string, unknown>): void;
  error(error: Error): void;
}

export interface SpanTracker {
  startSpan(type: SpanType, metadata?: Record<string, unknown>): Span;
}

/** Span 内部状态 */
interface SpanState {
  id: string;
  type: SpanType;
  metadata: Record<string, unknown>;
  startTime: number;
  endTime?: number;
  error?: string;
  result?: Record<string, unknown>;
}

/** 内存 Span 追踪器实现 */
export class InMemorySpanTracker implements SpanTracker {
  private spans: SpanState[] = [];

  startSpan(type: SpanType, metadata?: Record<string, unknown>): Span {
    const id = randomUUID();
    const state: SpanState = {
      id,
      type,
      metadata: metadata ?? {},
      startTime: Date.now(),
    };
    this.spans.push(state);

    return {
      id,
      end: (result?: Record<string, unknown>) => {
        state.endTime = Date.now();
        state.result = result;
      },
      error: (err: Error) => {
        state.endTime = Date.now();
        state.error = err.message;
      },
    };
  }

  /** 获取所有已记录的 span（用于测试/导出） */
  getAllSpans(): ReadonlyArray<SpanState> {
    return this.spans;
  }

  /** 清空 */
  clear(): void {
    this.spans = [];
  }
}
```

- [ ] **Step 3: Verify TypeScript compilation**

```bash
cd vico/agent && npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add vico/agent/src/observable/
git commit -m "feat(agent): implement MittEventRecorder and InMemorySpanTracker"
```

---

### Task 8: HookRunner Implementation

**Files:**
- Create: `packages/agent/src/hook/hook-runner.ts`

**Interfaces:**
- Consumes: `HookRunner`, `HookEvent`, `HookResult` from `hook/hook-types.ts`
- Produces: `HookRunnerImpl` class, `CompositeHookRunner` class

- [ ] **Step 1: Write HookRunner implementation**

```typescript
// src/hook/hook-runner.ts
import type { HookRunner, HookEvent, HookResult } from './hook-types.js';

/** 单个 Hook 的执行器实现 */
export class HookRunnerImpl implements HookRunner {
  constructor(
    public readonly event: HookEvent,
    private handler: (data: unknown) => Promise<HookResult>,
  ) {}

  async run(data: unknown): Promise<HookResult> {
    try {
      return await this.handler(data);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { action: 'continue', message: `Hook error: ${message}` };
    }
  }
}

/** 组合多个 HookRunner，按顺序执行 */
export class CompositeHookRunner {
  private runners: HookRunner[] = [];

  register(runner: HookRunner): void {
    this.runners.push(runner);
  }

  remove(event: HookEvent): void {
    this.runners = this.runners.filter((r) => r.event !== event);
  }

  getByEvent(event: HookEvent): HookRunner[] {
    return this.runners.filter((r) => r.event === event);
  }

  /** 按顺序执行所有匹配 event 的 hook，遇到 deny 则停止 */
  async runAll(event: HookEvent, data: unknown): Promise<HookResult> {
    let currentData = data;
    for (const runner of this.getByEvent(event)) {
      const result = await runner.run(currentData);
      if (result.action === 'deny') return result;
      if (result.action === 'modify' && result.modifiedData !== undefined) {
        currentData = result.modifiedData;
      }
    }
    return { action: 'continue', modifiedData: currentData };
  }
}
```

- [ ] **Step 2: Verify TypeScript compilation**

```bash
cd vico/agent && npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add vico/agent/src/hook/
git commit -m "feat(agent): implement HookRunner and CompositeHookRunner"
```

---

### Task 9: AgentRuntime Implementation

**Files:**
- Create: `packages/agent/src/agent-runtime/agent-runtime.ts`

**Interfaces:**
- Consumes: `AgentConfig` from `contracts/agent.ts`, `AgentLoop` port from `agent-loop/agent-loop.ts`
- Produces: `Agent` type, `AgentRuntime` interface, `AgentRuntimeImpl` class

- [ ] **Step 1: Write AgentRuntime**

```typescript
// src/agent-runtime/agent-runtime.ts
import type { AgentConfig } from '../contracts/agent.js';
import type { AgentLoop } from '../agent-loop/agent-loop.js';

/** Agent 实例 */
export interface Agent {
  readonly config: AgentConfig;
  readonly loop: AgentLoop;
}

/** Agent 工厂函数 — 由外部注入，组装 AgentLoop */
export type AgentFactory = (config: AgentConfig) => Promise<Agent>;

/** Agent 运行时容器端口 */
export interface AgentRuntime {
  createAgent(config: AgentConfig): Promise<Agent>;
  destroyAgent(agentId: string): Promise<void>;
  updateAgent(agentId: string, config: Partial<AgentConfig>): Promise<Agent>;
  getAgent(agentId: string): Agent | undefined;
  listAgents(tenantId: string): Agent[];
  reloadAgent(agentId: string): Promise<Agent>;
  isHealthy(agentId: string): boolean;
}

/** Agent 缓存条目 */
interface CacheEntry {
  agent: Agent;
  lastUsedAt: number;
}

/** AgentRuntime 默认实现 */
export class AgentRuntimeImpl implements AgentRuntime {
  private cache: Map<string, CacheEntry> = new Map();
  private factory: AgentFactory;
  private maxCached: number;

  constructor(factory: AgentFactory, maxCached = 50) {
    this.factory = factory;
    this.maxCached = maxCached;
  }

  /** 缓存键 = tenant_id + agent_id */
  private cacheKey(config: AgentConfig): string {
    return `${config.tenantId}:${config.id}`;
  }

  async createAgent(config: AgentConfig): Promise<Agent> {
    const key = this.cacheKey(config);
    const existing = this.cache.get(key);
    if (existing) {
      existing.lastUsedAt = Date.now();
      return existing.agent;
    }

    const agent = await this.factory(config);
    this.cache.set(key, { agent, lastUsedAt: Date.now() });
    this.evictIfNeeded();
    return agent;
  }

  async destroyAgent(agentId: string): Promise<void> {
    // 按 agentId 查找所有租户的缓存
    for (const [key, entry] of this.cache) {
      if (entry.agent.config.id === agentId) {
        this.cache.delete(key);
      }
    }
  }

  async updateAgent(agentId: string, patch: Partial<AgentConfig>): Promise<Agent> {
    // 找到旧 agent，merge 配置后重建
    for (const [key, entry] of this.cache) {
      if (entry.agent.config.id === agentId) {
        const newConfig = { ...entry.agent.config, ...patch };
        this.cache.delete(key);
        return this.createAgent(newConfig);
      }
    }
    throw new Error(`Agent ${agentId} not found in cache`);
  }

  getAgent(agentId: string): Agent | undefined {
    for (const entry of this.cache.values()) {
      if (entry.agent.config.id === agentId) {
        entry.lastUsedAt = Date.now();
        return entry.agent;
      }
    }
    return undefined;
  }

  listAgents(tenantId: string): Agent[] {
    const result: Agent[] = [];
    for (const [key, entry] of this.cache) {
      if (key.startsWith(`${tenantId}:`)) {
        result.push(entry.agent);
      }
    }
    return result;
  }

  async reloadAgent(agentId: string): Promise<Agent> {
    for (const [key, entry] of this.cache) {
      if (entry.agent.config.id === agentId) {
        this.cache.delete(key);
        return this.createAgent(entry.agent.config);
      }
    }
    throw new Error(`Agent ${agentId} not found`);
  }

  isHealthy(agentId: string): boolean {
    return this.getAgent(agentId) !== undefined;
  }

  /** LRU 淘汰：超过 maxCached 时移除最久未使用的条目 */
  private evictIfNeeded(): void {
    while (this.cache.size > this.maxCached) {
      let oldestKey = '';
      let oldestTime = Infinity;
      for (const [key, entry] of this.cache) {
        if (entry.lastUsedAt < oldestTime) {
          oldestTime = entry.lastUsedAt;
          oldestKey = key;
        }
      }
      if (oldestKey) this.cache.delete(oldestKey);
    }
  }
}
```

- [ ] **Step 2: Verify TypeScript compilation**

```bash
cd vico/agent && npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add vico/agent/src/agent-runtime/
git commit -m "feat(agent): implement AgentRuntime with LRU cache and dynamic agent lifecycle"
```

---

### Task 10: AgentLoop Implementation (Core Engine)

**Files:**
- Create: `packages/agent/src/agent-loop/agent-loop.ts`

**Interfaces:**
- Consumes: `ModelClient` from `model/model-client.ts`, `PromptAssembler` from `prompt/assembler.ts`, `ToolHost` from `tool/tool-host.ts`, `EventRecorder` from `observable/event-recorder.ts`, `SpanTracker` from `observable/span-tracker.ts`, `CompositeHookRunner` from `hook/hook-runner.ts`, `ContextCompactor` from `agent-loop/context-compactor.ts`
- Produces: `AgentLoop` interface, `AgentLoopImpl` class, `TurnResult` type

- [ ] **Step 1: Write AgentLoop implementation**

```typescript
// src/agent-loop/agent-loop.ts
import type { ModelClient, ModelMessage } from '../model/model-client.js';
import type { PromptAssembler, PromptContext } from '../prompt/assembler.js';
import type { ToolHost, ToolExecutionContext } from '../tool/tool-host.js';
import type { ToolCall, ToolResult } from '../contracts/tool.js';
import type { EventRecorder } from '../observable/event-recorder.js';
import type { SpanTracker } from '../observable/span-tracker.js';
import type { CompositeHookRunner } from '../hook/hook-runner.js';
import type { ContextCompactor } from './context-compactor.js';
import type { AgentConfig } from '../contracts/agent.js';

/** Turn 完成结果 */
export interface TurnResult {
  status: 'completed' | 'failed' | 'aborted' | 'interrupted';
  steps: number;
  usage: { input: number; output: number };
  messages: ModelMessage[];
}

/** Agent 循环引擎端口 */
export interface AgentLoop {
  runTurn(
    threadId: string,
    history: ModelMessage[],
    userMessage: ModelMessage,
    signal: AbortSignal,
  ): Promise<TurnResult>;
  interrupt(): void;
  steer(text: string): void;
}

/** AgentLoop 构造选项 */
export interface AgentLoopOptions {
  config: AgentConfig;
  model: ModelClient;
  toolHost: ToolHost;
  promptAssembler: PromptAssembler;
  compactor?: ContextCompactor;
  hooks?: CompositeHookRunner;
  events: EventRecorder;
  spanTracker: SpanTracker;
}

/** AgentLoop 默认实现 */
export class AgentLoopImpl implements AgentLoop {
  private config: AgentConfig;
  private model: ModelClient;
  private toolHost: ToolHost;
  private promptAssembler: PromptAssembler;
  private compactor?: ContextCompactor;
  private hooks?: CompositeHookRunner;
  private events: EventRecorder;
  private spanTracker: SpanTracker;
  private steerBuffer: string[] = [];
  private interrupted = false;

  constructor(options: AgentLoopOptions) {
    this.config = options.config;
    this.model = options.model;
    this.toolHost = options.toolHost;
    this.promptAssembler = options.promptAssembler;
    this.compactor = options.compactor;
    this.hooks = options.hooks;
    this.events = options.events;
    this.spanTracker = options.spanTracker;
  }

  async runTurn(
    threadId: string,
    history: ModelMessage[],
    userMessage: ModelMessage,
    signal: AbortSignal,
  ): Promise<TurnResult> {
    const turnSpan = this.spanTracker.startSpan('agent_run');
    this.interrupted = false;

    const messages = [...history, userMessage];
    let steps = 0;
    const usage = { input: 0, output: 0 };

    try {
      // 1. 前置：排干 steer 缓冲区
      const steerText = this.drainSteerBuffer();
      if (steerText) {
        messages.push({ role: 'user', content: steerText });
      }

      // 2. 执行 turn:start hooks
      if (this.hooks) {
        const hookResult = await this.hooks.runAll('turn:start', { threadId, messages });
        if (hookResult.action === 'deny') {
          turnSpan.end({ status: 'denied' });
          return { status: 'interrupted', steps: 0, usage, messages };
        }
      }

      // 3. 主循环
      while (steps < this.config.maxSteps && !this.interrupted) {
        if (signal.aborted) {
          turnSpan.end({ status: 'aborted' });
          return { status: 'aborted', steps, usage, messages };
        }

        this.events.emit({ type: 'step_start', step: steps + 1 });

        // 3.1 组装 prompt
        const promptCtx = this.buildPromptContext(messages);
        const request = this.promptAssembler.assemble(promptCtx);
        request.abortSignal = signal;

        // 3.2 调用模型
        let fullText = '';
        const toolCalls: ToolCall[] = [];

        const modelSpan = this.spanTracker.startSpan('model_step', { step: steps + 1 });

        for await (const chunk of this.model.stream(request)) {
          switch (chunk.type) {
            case 'text_delta':
              fullText += chunk.content;
              this.events.emit({ type: 'text_delta', content: chunk.content });
              break;
            case 'reasoning_delta':
              this.events.emit({ type: 'reasoning_delta', content: chunk.content });
              break;
            case 'tool_call_complete':
              toolCalls.push({ id: chunk.id, name: chunk.name, args: chunk.args });
              this.events.emit({
                type: 'tool_call_start',
                id: chunk.id,
                name: chunk.name,
              });
              break;
            case 'usage':
              usage.input += chunk.input;
              usage.output += chunk.output;
              break;
            case 'error':
              modelSpan.error(new Error(chunk.message));
              this.events.emit({ type: 'error', message: chunk.message });
              break;
          }
        }

        modelSpan.end({ textLength: fullText.length, toolCalls: toolCalls.length });

        // 3.3 如果有 assistant 文本回复，加入消息
        if (fullText) {
          messages.push({ role: 'assistant', content: fullText });
        }

        // 3.4 如果没有工具调用，循环结束
        if (toolCalls.length === 0) {
          this.events.emit({ type: 'step_end', step: steps + 1 });
          break;
        }

        // 3.5 执行工具调用（Phase 1: 占位执行 — 直接交给 ToolHost）
        const toolSpan = this.spanTracker.startSpan('tool_call', { count: toolCalls.length });
        const toolResults = await this.dispatchTools(toolCalls, threadId);
        toolSpan.end({ results: toolResults.length });

        // 3.6 将工具结果追加到消息
        for (const result of toolResults) {
          messages.push({
            role: 'tool',
            content: JSON.stringify(result.output),
            toolCallId: result.callId,
          });
          this.events.emit({
            type: 'tool_result',
            id: result.callId,
            name: result.name,
            status: result.status,
            output: result.output,
          });
        }

        this.events.emit({ type: 'step_end', step: steps + 1 });
        steps++;
      }

      // 4. 后置：turn:end hooks
      if (this.hooks) {
        await this.hooks.runAll('turn:end', { threadId, messages, usage });
      }

      turnSpan.end({ status: 'completed', steps });
      this.events.emit({ type: 'done', usage });
      return {
        status: this.interrupted ? 'interrupted' : 'completed',
        steps,
        usage,
        messages,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      turnSpan.error(err as Error);
      this.events.emit({ type: 'error', message });
      return { status: 'failed', steps, usage, messages };
    }
  }

  /** 工具分发（Phase 1：透传给 ToolHost） */
  private async dispatchTools(calls: ToolCall[], threadId: string): Promise<ToolResult[]> {
    // Phase 1 简单实现：逐个串行执行
    // Phase 2 将支持并行组 + 审批策略
    const context: ToolExecutionContext = {
      tenantId: this.config.tenantId,
      userId: '', // Phase 2 从上下文注入
      agentId: this.config.id,
      threadId,
      workspace: '',
      awaitApproval: async () => ({ approved: true }),
      hooks: this.hooks?.getByEvent('tool:before') ?? [],
      signal: new AbortController().signal,
    };

    return this.toolHost.executeBatch(calls, context);
  }

  private buildPromptContext(messages: ModelMessage[]): PromptContext {
    return {
      agent: this.config,
      skillCatalog: [],
      memoryItems: [],
      ragResults: [],
      history: messages,
      tools: [],
      dynamicInstructions: this.steerBuffer.length > 0 ? [this.drainSteerBuffer()] : [],
    };
  }

  private drainSteerBuffer(): string {
    const text = this.steerBuffer.join('\n');
    this.steerBuffer = [];
    return text;
  }

  interrupt(): void {
    this.interrupted = true;
  }

  steer(text: string): void {
    this.steerBuffer.push(text);
  }
}
```

- [ ] **Step 2: Verify TypeScript compilation**

```bash
cd vico/agent && npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add vico/agent/src/agent-loop/
git commit -m "feat(agent): implement AgentLoop core engine with model+tool loop"
```

---

### Task 11: Public API — Barrel Exports

**Files:**
- Create: `packages/agent/src/index.ts`

**Interfaces:**
- Consumes: All public types and classes from all modules
- Produces: Unified `@vico/agent` package entry point

- [ ] **Step 1: Write index.ts**

```typescript
// src/index.ts — @vico/agent public API

// Contracts
export { AgentConfigSchema, type AgentConfig, type ModelRef } from './contracts/agent.js';
export {
  ToolSpecSchema,
  ToolCallSchema,
  ToolResultSchema,
  ToolPolicySchema,
  ToolKindSchema,
  type ToolSpec,
  type ToolCall,
  type ToolResult,
  type ToolPolicy,
  type ToolKind,
} from './contracts/tool.js';
export { MemoryRecordSchema, type MemoryRecord } from './contracts/memory.js';
export { SSEEventSchema, SpanTypeSchema, type SSEEvent, type SpanType } from './contracts/events.js';

// Ports — ModelClient
export {
  type ModelClient,
  type ModelRequest,
  type ModelMessage,
  type ModelStreamChunk,
  type MessageRole,
} from './model/model-client.js';
export { AISDKModelClient } from './model/ai-sdk-adapter.js';

// Ports — PromptAssembler
export {
  type PromptAssembler,
  type PromptContext,
  type SkillCatalogEntry,
  type RagChunk,
  PromptAssemblerImpl,
} from './prompt/assembler.js';

// Ports — ToolHost
export {
  type ToolHost,
  type ToolExecutionContext,
  type ApprovalDecision,
} from './tool/tool-host.js';

// Ports — MemoryStore
export { type MemoryStore } from './memory/memory-store.js';

// Ports — SkillLoader
export { type SkillLoader, type Skill } from './skill/skill-loader.js';

// Ports — SessionStore
export {
  type SessionStore,
  type Thread,
  type Turn,
  type ConversationEntry,
} from './session/session-store.js';

// Ports — ContextCompactor
export { type ContextCompactor } from './agent-loop/context-compactor.js';

// Ports — Hook
export {
  type HookRunner,
  type HookEvent,
  type HookResult,
} from './hook/hook-types.js';
export { HookRunnerImpl, CompositeHookRunner } from './hook/hook-runner.js';

// Ports — Observable
export { type EventRecorder, MittEventRecorder } from './observable/event-recorder.js';
export {
  type SpanTracker,
  type Span,
  InMemorySpanTracker,
} from './observable/span-tracker.js';

// Runtime
export {
  type AgentRuntime,
  type Agent,
  type AgentFactory,
  AgentRuntimeImpl,
} from './agent-runtime/agent-runtime.js';

// AgentLoop
export {
  type AgentLoop,
  type AgentLoopOptions,
  type TurnResult,
  AgentLoopImpl,
} from './agent-loop/agent-loop.js';
```

- [ ] **Step 2: Verify TypeScript compilation**

```bash
cd vico/agent && npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add vico/agent/src/index.ts
git commit -m "feat(agent): add public API barrel exports"
```

---

### Task 12: Unit Tests

**Files:**
- Create: `packages/agent/src/__tests__/contracts.test.ts`
- Create: `packages/agent/src/__tests__/prompt-assembler.test.ts`
- Create: `packages/agent/src/__tests__/agent-runtime.test.ts`
- Create: `packages/agent/src/__tests__/agent-loop.test.ts`
- Create: `packages/agent/src/__tests__/event-recorder.test.ts`
- Create: `packages/agent/src/__tests__/hook-runner.test.ts`
- Create: `packages/agent/src/__tests__/span-tracker.test.ts`

**Interfaces:**
- Consumes: All public types from `@vico/agent`

- [ ] **Step 1: Write contracts test**

```typescript
// src/__tests__/contracts.test.ts
import { describe, it, expect } from 'vitest';
import { AgentConfigSchema } from '../contracts/agent.js';
import { ToolSpecSchema, ToolCallSchema, ToolResultSchema } from '../contracts/tool.js';
import { MemoryRecordSchema } from '../contracts/memory.js';
import { SSEEventSchema } from '../contracts/events.js';

describe('AgentConfigSchema', () => {
  it('parses valid config', () => {
    const result = AgentConfigSchema.safeParse({
      id: '00000000-0000-0000-0000-000000000001',
      tenantId: 'tenant-1',
      name: 'test-agent',
      systemPrompt: 'You are helpful.',
      model: { provider: 'openai', model: 'gpt-4o' },
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing required fields', () => {
    const result = AgentConfigSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('applies defaults', () => {
    const result = AgentConfigSchema.safeParse({
      id: '00000000-0000-0000-0000-000000000001',
      tenantId: 'tenant-1',
      name: 'test',
      model: { provider: 'openai', model: 'gpt-4o' },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.temperature).toBe(0.7);
      expect(result.data.maxSteps).toBe(10);
    }
  });
});

describe('ToolSpecSchema', () => {
  it('parses valid tool spec', () => {
    const result = ToolSpecSchema.safeParse({
      name: 'search',
      description: 'Search the web',
      inputSchema: { type: 'object', properties: { q: { type: 'string' } } },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.policy).toBe('auto');
    }
  });
});

describe('SSEEventSchema', () => {
  it('parses text_delta event', () => {
    const result = SSEEventSchema.safeParse({ type: 'text_delta', content: 'hello' });
    expect(result.success).toBe(true);
  });

  it('parses done event', () => {
    const result = SSEEventSchema.safeParse({
      type: 'done',
      usage: { input: 100, output: 50 },
    });
    expect(result.success).toBe(true);
  });

  it('rejects unknown event type', () => {
    const result = SSEEventSchema.safeParse({ type: 'unknown' });
    expect(result.success).toBe(false);
  });
});
```

- [ ] **Step 2: Run contracts test**

```bash
cd vico/agent && npx vitest run src/__tests__/contracts.test.ts
```
Expected: all 6 tests pass.

- [ ] **Step 3: Write PromptAssembler test**

```typescript
// src/__tests__/prompt-assembler.test.ts
import { describe, it, expect } from 'vitest';
import { PromptAssemblerImpl } from '../prompt/assembler.js';
import type { AgentConfig } from '../contracts/agent.js';

function makeConfig(overrides?: Partial<AgentConfig>): AgentConfig {
  return {
    id: '00000000-0000-0000-0000-000000000001',
    tenantId: 'tenant-1',
    name: 'test',
    systemPrompt: 'You are a helpful assistant.',
    model: { provider: 'openai', model: 'gpt-4o' },
    temperature: 0.7,
    maxTokens: 4096,
    maxSteps: 10,
    ...overrides,
  };
}

describe('PromptAssemblerImpl', () => {
  it('assembles system prompt + history', () => {
    const assembler = new PromptAssemblerImpl();
    const req = assembler.assemble({
      agent: makeConfig(),
      skillCatalog: [],
      memoryItems: [],
      ragResults: [],
      history: [{ role: 'user', content: 'hi' }],
      tools: [],
      dynamicInstructions: [],
    });

    expect(req.system).toContain('You are a helpful assistant.');
    expect(req.messages).toHaveLength(1);
    expect(req.messages[0].content).toBe('hi');
  });

  it('includes skill catalog in system prompt', () => {
    const assembler = new PromptAssemblerImpl();
    const req = assembler.assemble({
      agent: makeConfig(),
      skillCatalog: [
        { name: 'code-review', description: 'Review code', location: '/skills/code-review' },
      ],
      memoryItems: [],
      ragResults: [],
      history: [],
      tools: [],
      dynamicInstructions: [],
    });

    expect(req.system).toContain('<available_skills>');
    expect(req.system).toContain('code-review');
  });

  it('puts dynamic context after history', () => {
    const assembler = new PromptAssemblerImpl();
    const req = assembler.assemble({
      agent: makeConfig(),
      skillCatalog: [],
      memoryItems: [{ id: '00000000-0000-0000-0000-000000000001', tenantId: 't1', content: 'remember this', createdAt: 1 }],
      ragResults: [],
      history: [{ role: 'user', content: 'hi' }],
      tools: [],
      dynamicInstructions: ['extra hint'],
    });

    // history[0] = user message, history[1] = memory system message, history[2] = dynamic instruction
    expect(req.messages).toHaveLength(3);
    expect(req.messages[0].content).toBe('hi');
    expect(req.messages[1].content).toContain('remember this');
    expect(req.messages[2].content).toBe('extra hint');
  });
});
```

- [ ] **Step 4: Run PromptAssembler test**

```bash
cd vico/agent && npx vitest run src/__tests__/prompt-assembler.test.ts
```
Expected: all 3 tests pass.

- [ ] **Step 5: Write AgentRuntime test**

```typescript
// src/__tests__/agent-runtime.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { AgentRuntimeImpl, type Agent, type AgentFactory } from '../agent-runtime/agent-runtime.js';
import type { AgentConfig } from '../contracts/agent.js';

function makeConfig(id: string, tenantId = 'tenant-1'): AgentConfig {
  return {
    id,
    tenantId,
    name: `agent-${id}`,
    systemPrompt: 'test',
    model: { provider: 'openai', model: 'gpt-4o' },
    temperature: 0.7,
    maxTokens: 4096,
    maxSteps: 10,
  };
}

describe('AgentRuntimeImpl', () => {
  let factoryCallCount = 0;
  let runtime: AgentRuntimeImpl;

  const factory: AgentFactory = async (config) => {
    factoryCallCount++;
    return {
      config,
      loop: {} as any, // mock loop
    };
  };

  beforeEach(() => {
    factoryCallCount = 0;
    runtime = new AgentRuntimeImpl(factory, 10);
  });

  it('creates agent via factory', async () => {
    const agent = await runtime.createAgent(makeConfig('agent-1'));
    expect(agent.config.name).toBe('agent-agent-1');
    expect(factoryCallCount).toBe(1);
  });

  it('returns cached agent on second create', async () => {
    await runtime.createAgent(makeConfig('agent-1'));
    await runtime.createAgent(makeConfig('agent-1'));
    expect(factoryCallCount).toBe(1); // factory only called once
  });

  it('lists agents by tenant', async () => {
    await runtime.createAgent(makeConfig('agent-1', 'tenant-A'));
    await runtime.createAgent(makeConfig('agent-2', 'tenant-A'));
    await runtime.createAgent(makeConfig('agent-3', 'tenant-B'));

    const tenantAAgents = runtime.listAgents('tenant-A');
    expect(tenantAAgents).toHaveLength(2);
  });

  it('destroys agent', async () => {
    await runtime.createAgent(makeConfig('agent-1'));
    await runtime.destroyAgent('agent-1');
    expect(runtime.getAgent('agent-1')).toBeUndefined();
  });

  it('updates agent config', async () => {
    await runtime.createAgent(makeConfig('agent-1'));
    const updated = await runtime.updateAgent('agent-1', { name: 'new-name' });
    expect(updated.config.name).toBe('new-name');
    expect(factoryCallCount).toBe(2); // re-created via factory
  });

  it('reloads agent', async () => {
    await runtime.createAgent(makeConfig('agent-1'));
    await runtime.reloadAgent('agent-1');
    expect(factoryCallCount).toBe(2);
  });

  it('evicts LRU when over capacity', async () => {
    const smallRuntime = new AgentRuntimeImpl(factory, 3);
    await smallRuntime.createAgent(makeConfig('agent-1'));
    await smallRuntime.createAgent(makeConfig('agent-2'));
    await smallRuntime.createAgent(makeConfig('agent-3'));
    await smallRuntime.createAgent(makeConfig('agent-4')); // triggers eviction

    // agent-1 should be evicted (oldest)
    expect(smallRuntime.getAgent('agent-1')).toBeUndefined();
    expect(smallRuntime.getAgent('agent-4')).toBeDefined();
  });
});
```

- [ ] **Step 6: Run AgentRuntime test**

```bash
cd vico/agent && npx vitest run src/__tests__/agent-runtime.test.ts
```
Expected: all 7 tests pass.

- [ ] **Step 7: Write MittEventRecorder test**

```typescript
// src/__tests__/event-recorder.test.ts
import { describe, it, expect, vi } from 'vitest';
import { MittEventRecorder } from '../observable/event-recorder.js';
import type { SSEEvent } from '../contracts/events.js';

describe('MittEventRecorder', () => {
  it('emits and receives events', () => {
    const recorder = new MittEventRecorder();
    const handler = vi.fn();

    recorder.on('text_delta', handler);
    recorder.emit({ type: 'text_delta', content: 'hello' });

    expect(handler).toHaveBeenCalledOnce();
    expect(handler.mock.calls[0][0]).toMatchObject({ type: 'text_delta', content: 'hello' });
  });

  it('supports wildcard listener', () => {
    const recorder = new MittEventRecorder();
    const handler = vi.fn();

    recorder.on('*', handler);
    recorder.emit({ type: 'text_delta', content: 'a' });
    recorder.emit({ type: 'done' });

    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('removes listener via off()', () => {
    const recorder = new MittEventRecorder();
    const handler = vi.fn();

    recorder.on('text_delta', handler);
    recorder.off('text_delta', handler);
    recorder.emit({ type: 'text_delta', content: 'hello' });

    expect(handler).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 8: Run EventRecorder test**

```bash
cd vico/agent && npx vitest run src/__tests__/event-recorder.test.ts
```
Expected: all 3 tests pass.

- [ ] **Step 9: Write HookRunner test**

```typescript
// src/__tests__/hook-runner.test.ts
import { describe, it, expect } from 'vitest';
import { HookRunnerImpl, CompositeHookRunner } from '../hook/hook-runner.js';

describe('HookRunnerImpl', () => {
  it('runs handler and returns result', async () => {
    const runner = new HookRunnerImpl('turn:start', async (data) => ({
      action: 'continue',
      message: `got: ${data}`,
    }));
    const result = await runner.run('test-data');
    expect(result.action).toBe('continue');
    expect(result.message).toBe('got: test-data');
  });

  it('catches handler errors gracefully', async () => {
    const runner = new HookRunnerImpl('tool:before', async () => {
      throw new Error('boom');
    });
    const result = await runner.run({});
    expect(result.action).toBe('continue');
    expect(result.message).toContain('boom');
  });
});

describe('CompositeHookRunner', () => {
  it('runs matching hooks in order', async () => {
    const composite = new CompositeHookRunner();
    const order: number[] = [];

    composite.register(
      new HookRunnerImpl('turn:start', async () => {
        order.push(1);
        return { action: 'continue' };
      }),
    );
    composite.register(
      new HookRunnerImpl('turn:start', async () => {
        order.push(2);
        return { action: 'continue' };
      }),
    );

    await composite.runAll('turn:start', {});
    expect(order).toEqual([1, 2]);
  });

  it('stops on deny', async () => {
    const composite = new CompositeHookRunner();
    const order: number[] = [];

    composite.register(
      new HookRunnerImpl('tool:before', async () => {
        order.push(1);
        return { action: 'deny', message: 'blocked' };
      }),
    );
    composite.register(
      new HookRunnerImpl('tool:before', async () => {
        order.push(2);
        return { action: 'continue' };
      }),
    );

    const result = await composite.runAll('tool:before', {});
    expect(result.action).toBe('deny');
    expect(order).toEqual([1]); // second hook never runs
  });

  it('passes modified data through', async () => {
    const composite = new CompositeHookRunner();

    composite.register(
      new HookRunnerImpl('prompt:submit', async (data) => ({
        action: 'modify',
        modifiedData: { ...(data as any), extra: true },
      })),
    );

    const result = await composite.runAll('prompt:submit', { original: 1 });
    expect(result.action).toBe('continue');
    expect((result.modifiedData as any).original).toBe(1);
    expect((result.modifiedData as any).extra).toBe(true);
  });
});
```

- [ ] **Step 10: Run HookRunner test**

```bash
cd vico/agent && npx vitest run src/__tests__/hook-runner.test.ts
```
Expected: all 4 tests pass.

- [ ] **Step 11: Write SpanTracker test**

```typescript
// src/__tests__/span-tracker.test.ts
import { describe, it, expect } from 'vitest';
import { InMemorySpanTracker } from '../observable/span-tracker.js';

describe('InMemorySpanTracker', () => {
  it('starts and ends a span', () => {
    const tracker = new InMemorySpanTracker();
    const span = tracker.startSpan('agent_run', { threadId: 't1' });

    expect(span.id).toBeDefined();
    span.end({ status: 'ok' });

    const spans = tracker.getAllSpans();
    expect(spans).toHaveLength(1);
    expect(spans[0].type).toBe('agent_run');
    expect(spans[0].result).toEqual({ status: 'ok' });
  });

  it('records error on span', () => {
    const tracker = new InMemorySpanTracker();
    const span = tracker.startSpan('tool_call');
    span.error(new Error('timeout'));

    const spans = tracker.getAllSpans();
    expect(spans[0].error).toBe('timeout');
  });

  it('clear removes all spans', () => {
    const tracker = new InMemorySpanTracker();
    tracker.startSpan('model_step').end();
    tracker.clear();
    expect(tracker.getAllSpans()).toHaveLength(0);
  });
});
```

- [ ] **Step 12: Run SpanTracker test**

```bash
cd vico/agent && npx vitest run src/__tests__/span-tracker.test.ts
```
Expected: all 3 tests pass.

- [ ] **Step 13: Write AgentLoop integration test**

```typescript
// src/__tests__/agent-loop.test.ts
import { describe, it, expect, vi } from 'vitest';
import { AgentLoopImpl, type AgentLoopOptions } from '../agent-loop/agent-loop.js';
import type { ModelClient, ModelStreamChunk, ModelRequest } from '../model/model-client.js';
import type { AgentConfig } from '../contracts/agent.js';
import { MittEventRecorder } from '../observable/event-recorder.js';
import { InMemorySpanTracker } from '../observable/span-tracker.js';
import { PromptAssemblerImpl } from '../prompt/assembler.js';

function makeConfig(): AgentConfig {
  return {
    id: '00000000-0000-0000-0000-000000000001',
    tenantId: 'tenant-1',
    name: 'test-agent',
    systemPrompt: 'You are helpful.',
    model: { provider: 'openai', model: 'gpt-4o' },
    temperature: 0.7,
    maxTokens: 4096,
    maxSteps: 3,
  };
}

/** 创建一个返回预设 chunks 的 mock ModelClient */
function mockModelClient(chunks: ModelStreamChunk[]): ModelClient {
  return {
    provider: 'mock',
    model: 'mock',
    async *stream(_request: ModelRequest): AsyncIterable<ModelStreamChunk> {
      for (const chunk of chunks) {
        yield chunk;
      }
    },
  };
}

/** mock ToolHost — 总是返回 success */
const mockToolHost = {
  listTools: async () => [],
  execute: async (call: any) => ({ callId: call.id, name: call.name, status: 'success' as const, output: 'ok' }),
  executeBatch: async (calls: any[]) =>
    calls.map((c) => ({ callId: c.id, name: c.name, status: 'success' as const, output: 'ok' })),
};

describe('AgentLoopImpl', () => {
  it('completes a turn with text-only response', async () => {
    const events = new MittEventRecorder();
    const tracker = new InMemorySpanTracker();

    const model = mockModelClient([
      { type: 'text_delta', content: 'Hello!' },
      { type: 'completed', finishReason: 'stop' },
    ]);

    const loop = new AgentLoopImpl({
      config: makeConfig(),
      model,
      toolHost: mockToolHost as any,
      promptAssembler: new PromptAssemblerImpl(),
      events,
      spanTracker: tracker,
    });

    const result = await loop.runTurn(
      'thread-1',
      [],
      { role: 'user', content: 'hi' },
      new AbortController().signal,
    );

    expect(result.status).toBe('completed');
    expect(result.steps).toBe(0); // no tool calls, single turn
  });

  it('executes tool calls and continues loop', async () => {
    const events = new MittEventRecorder();
    const tracker = new InMemorySpanTracker();
    const doneEvents: any[] = [];
    events.on('done', (e) => doneEvents.push(e));

    const model = mockModelClient([
      { type: 'text_delta', content: 'Let me search.' },
      { type: 'tool_call_complete', id: 'call-1', name: 'search', args: { q: 'test' } },
      { type: 'completed', finishReason: 'tool_calls' },
      // second model step after tool results
      { type: 'text_delta', content: 'Found results.' },
      { type: 'completed', finishReason: 'stop' },
    ]);

    const loop = new AgentLoopImpl({
      config: makeConfig(),
      model,
      toolHost: mockToolHost as any,
      promptAssembler: new PromptAssemblerImpl(),
      events,
      spanTracker: tracker,
    });

    const result = await loop.runTurn(
      'thread-1',
      [],
      { role: 'user', content: 'search for test' },
      new AbortController().signal,
    );

    expect(result.status).toBe('completed');
    expect(result.steps).toBeGreaterThan(0);
    expect(doneEvents.length).toBe(1);

    // verify spans
    const spans = tracker.getAllSpans();
    expect(spans.some((s) => s.type === 'agent_run')).toBe(true);
    expect(spans.some((s) => s.type === 'tool_call')).toBe(true);
  });

  it('interrupts mid-turn', async () => {
    const events = new MittEventRecorder();
    const tracker = new InMemorySpanTracker();

    // model that yields text, then yields forever
    const model: ModelClient = {
      provider: 'mock',
      model: 'mock',
      async *stream(_request: ModelRequest): AsyncIterable<ModelStreamChunk> {
        yield { type: 'text_delta', content: 'thinking...' };
        // never yields completed — simulates long-running call
        await new Promise(() => {}); // eslint-disable-line
      },
    };

    const loop = new AgentLoopImpl({
      config: makeConfig(),
      model,
      toolHost: mockToolHost as any,
      promptAssembler: new PromptAssemblerImpl(),
      events,
      spanTracker: tracker,
    });

    // interrupt after 10ms
    setTimeout(() => loop.interrupt(), 10);

    const result = await loop.runTurn(
      'thread-1',
      [],
      { role: 'user', content: 'hi' },
      new AbortController().signal,
    );

    expect(result.status).toBe('interrupted');
  });
});
```

- [ ] **Step 14: Run AgentLoop test**

```bash
cd vico/agent && npx vitest run src/__tests__/agent-loop.test.ts
```
Expected: all 3 tests pass.

- [ ] **Step 15: Run full test suite**

```bash
cd vico/agent && npx vitest run
```
Expected: all tests pass (~26 tests across 7 files).

- [ ] **Step 16: Final commit**

```bash
git add vico/agent/src/__tests__/
git commit -m "test(agent): add unit tests for contracts, runtime, loop, observable, hooks"
```

---

## Verification Checklist

After all tasks complete, verify:

```bash
# 1. TypeScript compiles cleanly
cd vico/agent && npx tsc --noEmit

# 2. All tests pass
cd vico/agent && npx vitest run

# 3. Package can be imported from server (smoke test)
cd vico/server && node -e "require('@vico/agent')" 2>/dev/null || \
  node -e "import('@vico/agent').then(m => console.log(Object.keys(m).slice(0,10)))"
```
