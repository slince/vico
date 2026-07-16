# AI SDK v7 原生类型全链路重构 — 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `@vico/agent` 全链路改用 Vercel AI SDK v7 原生类型（`UIMessage`/`ModelMessage`/`UIMessageChunk`/`LanguageModelV4StreamPart`），删除全部自定义镜像类型，保留自研 agent loop（不用 `streamText`）。

**Architecture:** model 层用 `ai/internal` 积木（`standardizePrompt` + `convertToLanguageModelPrompt` + `prepareTools`）薄封装 `doStream`；TurnOutput 流词汇为 provider 原生 `LanguageModelV4StreamPart`；turn-stream 用 `createUIMessageStream`/`createUIMessageStreamResponse` 出 SSE；持久化消息 content 存原生 content 的 JSON。

**Tech Stack:** TypeScript ESM、ai@7.0.26（精确锁定）、@ai-sdk/provider@4.0.3、@ai-sdk/provider-utils@5.0.9、zod 4、vitest、Drizzle ORM。

**Spec:** [docs/superpowers/specs/2026-07-17-ai-sdk-v7-native-types-refactor-design.md](../specs/2026-07-17-ai-sdk-v7-native-types-refactor-design.md)

## Global Constraints

- `ai` 版本必须精确锁定 `"7.0.26"`（无 `^`），因使用 `ai/internal` 非公开 API
- `@ai-sdk/provider` 对齐 `^4.0.3`，`@ai-sdk/provider-utils` 对齐 `^5.0.9`
- ESM 导入带 `.js` 扩展名；注释遵循 CLAUDE.md 注释要求（JSDoc + 关键行注释）
- 不使用 `streamText` / `generateText` / `ToolLoopAgent`
- 持久化不做旧数据兼容（直切）；开发库可直接删除重建
- 每个 Task 结束提交一次 git commit

## 与 spec 的已确认偏差（实施时按本计划执行）

1. **tool-call input 解析**：不用 `parseToolCall`（需 ToolSet 泛型且校验失败会 throw，与现有"执行期 zod 校验"重复），改为 loop 内联 `JSON.parse`。
2. **assistant/tool 消息构造**：不用 `toResponseMessages`（其入参是 streamText 级 `ContentPart<TOOLS>`，构造中间格式代码更多），改为 `message-utils.ts` 手动构造原生 `AssistantModelMessage`/`ToolModelMessage`。
3. **custom chunk 映射**：v7 `UIMessageChunk` 原生就有 `{type:'custom'}` 和 `{type:'reasoning-file'}` 变体，直接 1:1 映射，不再用 `data-custom`。
4. **web 历史回放**：REST `MessageItem` 形状保持 `{id, role, content: 纯文本}`（服务端用 `getMessageText` 提取），web 适配器包装 parts 的 7 行逻辑保留。完整 UIMessage 历史回放（含工具 part）留待后续。

## 关键类型速查（实施者参考，全部已从 dist .d.ts 核实）

```ts
// ai（主包）：ModelMessage, UIMessage, UIMessageChunk, ToolSet, tool(), FinishReason,
//   LanguageModelUsage, convertToModelMessages, validateUIMessages,
//   createUIMessageStream, createUIMessageStreamResponse
// ai/internal：standardizePrompt({system?, messages?}) → Promise<{instructions, messages}>
//   convertToLanguageModelPrompt({prompt, supportedUrls, download}) → Promise<LanguageModelV4Prompt>
//   prepareTools({tools: ToolSet}) → Promise<LanguageModelV4FunctionTool[]|undefined>
//   asLanguageModelUsage(usage: LanguageModelV4Usage) → LanguageModelUsage（扁平）
// @ai-sdk/provider-utils：AssistantModelMessage, ToolModelMessage, TextPart, ToolCallPart,
//   ToolResultPart, ToolResultOutput（{type:'text'|'json'|'error-text'|'error-json'|...; value}）
// @ai-sdk/provider：LanguageModelV4, LanguageModelV4StreamPart, LanguageModelV4Usage
//   V4 ToolCall part: {type:'tool-call', toolCallId, toolName, input: string}（input 是 JSON 字符串）
//   V4 ToolResult part: {type:'tool-result', toolCallId, toolName, result, isError?}
//   V4 ToolApprovalRequest part: {type:'tool-approval-request', approvalId, toolCallId}（无 toolName/input）
//   V4 File part: {type:'file', mediaType, data: {type:'data', data: Uint8Array|string} | {type:'url', url: URL}}
```

---

### Task 1: 依赖对齐

**Files:**
- Modify: `packages/agent/package.json`
- Modify: `vico/server/package.json`

**Interfaces:**
- Produces: `packages/agent` 可 `import from 'ai'` 和 `'ai/internal'`

- [ ] **Step 1: 修改 packages/agent/package.json dependencies**

在 `"@ai-sdk/provider-utils": "^5.0.9",` 之后添加（注意精确版本无 `^`）：

```json
    "ai": "7.0.26",
```

- [ ] **Step 2: 修改 vico/server/package.json**

`"ai": "^6.0.204"` 改为 `"ai": "7.0.26"`。

- [ ] **Step 3: 安装并验证**

Run: `cd /Users/taosikai/www/js/vico && pnpm install`
Expected: 安装成功。若出现 zod peer 冲突（agent 包用 zod@4.4.3），确认 ai@7 的 peerDependencies 允许 zod 4（`cat node_modules/.pnpm/ai@7.0.26*/node_modules/ai/package.json | grep -A3 peerDependencies`），正常应直接通过。

Run: `node -e "import('ai/internal').then(m => console.log(typeof m.convertToLanguageModelPrompt))" --input-type=module` （在 packages/agent 目录下）
Expected: 输出 `function`

- [ ] **Step 4: Commit**

```bash
git add packages/agent/package.json vico/server/package.json pnpm-lock.yaml
git commit -m "chore: 引入 ai@7.0.26（精确锁定），vico/server ai v6→v7"
```

---

### Task 2: 独立类型错误修复（factory V4 + 两处 workspace undefined）

**Files:**
- Modify: `packages/agent/src/model/factory.ts:4,14,16`
- Modify: `packages/agent/src/memory/tool/working-memory-tool.ts:30`
- Modify: `packages/agent/src/tool/builtin/coding/lsp-tool.ts:174-184`

**Interfaces:**
- Produces: `createLanguageModel(ref: ModelRef): LanguageModelV4`

- [ ] **Step 1: factory.ts 三处 `LanguageModelV3` → `LanguageModelV4`**

```ts
import type {LanguageModelV4} from '@ai-sdk/provider';
// ...
 * @returns AI SDK 的 LanguageModelV4 实例
 */
export function createLanguageModel(ref: ModelRef): LanguageModelV4 {
```

- [ ] **Step 2: working-memory-tool.ts:30 补空串回退**

```ts
      const scopeId = wm.scope === 'user' ? ctx.session.thread.userId ?? '' : ctx.session.workspace ?? '';
```

- [ ] **Step 3: lsp-tool.ts 提取一次非空断言复用**

`executeLsp` 开头（原 175 行）改为：

```ts
async function executeLsp(args: z.infer<typeof lspParams>, ctx: ToolCallContext) {
  // 编码类工具必须在 workspace 内运行，session.workspace 由 loop 保证注入
  const workspace = ctx.session.workspace!;
  const absPath = resolveWorkspacePath(workspace, args.filePath);
```

原 180、184 行的 `ctx.session.workspace` 均改为 `workspace`。

- [ ] **Step 4: 验证这三个文件的错误消失**

Run: `cd packages/agent && pnpm typecheck 2>&1 | grep -E "factory|working-memory-tool|lsp-tool"`
Expected: 无输出（其余文件的错误后续 Task 消除）

- [ ] **Step 5: Commit**

```bash
git add packages/agent/src/model/factory.ts packages/agent/src/memory/tool/working-memory-tool.ts packages/agent/src/tool/builtin/coding/lsp-tool.ts
git commit -m "fix: factory 迁移 LanguageModelV4；修复 workspace undefined 类型错误"
```

---

### Task 3: message-utils.ts（原生消息工具函数，TDD）

**Files:**
- Create: `packages/agent/src/model/message-utils.ts`
- Test: `packages/agent/__tests__/model/message-utils.test.ts`

**Interfaces:**
- Produces（后续所有 Task 依赖）:
  - `getMessageText(msg: ModelMessage): string`
  - `getToolCalls(msg: ModelMessage): ToolCall[]`（Vico ToolCall `{id, name, args}`）
  - `hasToolResult(messages: ModelMessage[], toolCallId: string): boolean`
  - `getToolResultText(messages: ModelMessage[], toolCallId: string): string | undefined`
  - `buildAssistantMessage(text: string, toolCalls: ToolCall[]): AssistantModelMessage`
  - `buildToolResultMessage(result: ToolResult, content: string): ToolModelMessage`
  - `modelMessageToUIMessage(msg: ModelMessage, id: string): UIMessage | undefined`
  - `toToolSet(tools: Tool[]): ToolSet`

- [ ] **Step 1: 写失败测试**

```ts
// packages/agent/__tests__/model/message-utils.test.ts
import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import type { ModelMessage } from 'ai';
import {
  getMessageText, getToolCalls, hasToolResult, getToolResultText,
  buildAssistantMessage, buildToolResultMessage, modelMessageToUIMessage, toToolSet,
} from '../../src/model/message-utils.js';
import { createTool } from '../../src/tool/create-tool.js';

describe('message-utils', () => {
  it('getMessageText 支持 string 和 parts 两种 content', () => {
    expect(getMessageText({ role: 'user', content: 'hi' })).toBe('hi');
    expect(getMessageText({
      role: 'assistant',
      content: [{ type: 'text', text: 'a' }, { type: 'tool-call', toolCallId: '1', toolName: 't', input: {} }, { type: 'text', text: 'b' }],
    })).toBe('ab');
  });

  it('getToolCalls 从 assistant parts 提取 Vico ToolCall', () => {
    const msg: ModelMessage = {
      role: 'assistant',
      content: [{ type: 'tool-call', toolCallId: 'c1', toolName: 'echo', input: { x: 1 } }],
    };
    expect(getToolCalls(msg)).toEqual([{ id: 'c1', name: 'echo', args: { x: 1 } }]);
    expect(getToolCalls({ role: 'user', content: 'hi' })).toEqual([]);
  });

  it('buildAssistantMessage 组装 text + tool-call parts，空内容兜底空文本', () => {
    const msg = buildAssistantMessage('hello', [{ id: 'c1', name: 'echo', args: { x: 1 } }]);
    expect(msg).toEqual({
      role: 'assistant',
      content: [
        { type: 'text', text: 'hello' },
        { type: 'tool-call', toolCallId: 'c1', toolName: 'echo', input: { x: 1 } },
      ],
    });
    expect(buildAssistantMessage('', [])).toEqual({ role: 'assistant', content: [{ type: 'text', text: '' }] });
  });

  it('buildToolResultMessage 按成功/失败生成 text/error-text output', () => {
    const ok = buildToolResultMessage({ callId: 'c1', name: 'echo', status: 'success', output: 'r' }, 'r');
    expect(ok).toEqual({
      role: 'tool',
      content: [{ type: 'tool-result', toolCallId: 'c1', toolName: 'echo', output: { type: 'text', value: 'r' } }],
    });
    const err = buildToolResultMessage({ callId: 'c2', name: 'echo', status: 'error', output: null, error: 'boom' }, 'boom');
    expect((err.content[0] as { output: { type: string } }).output.type).toBe('error-text');
  });

  it('hasToolResult / getToolResultText 在消息链中查找工具结果', () => {
    const messages: ModelMessage[] = [
      { role: 'user', content: 'q' },
      buildToolResultMessage({ callId: 'c1', name: 'echo', status: 'success', output: 'ok' }, 'ok'),
    ];
    expect(hasToolResult(messages, 'c1')).toBe(true);
    expect(hasToolResult(messages, 'c2')).toBe(false);
    expect(getToolResultText(messages, 'c1')).toBe('ok');
    expect(getToolResultText(messages, 'c2')).toBeUndefined();
  });

  it('modelMessageToUIMessage 只转换有文本的非 tool 消息', () => {
    expect(modelMessageToUIMessage({ role: 'user', content: 'hi' }, 'm1')).toEqual({
      id: 'm1', role: 'user', parts: [{ type: 'text', text: 'hi' }],
    });
    expect(modelMessageToUIMessage(buildToolResultMessage({ callId: 'c', name: 'n', status: 'success', output: 1 }, '1'), 'm2')).toBeUndefined();
  });

  it('toToolSet 将 Vico Tool 转为 ai ToolSet', () => {
    const echo = createTool({
      name: 'echo', description: 'Echo', inputSchema: z.object({ message: z.string() }),
      execute: async (args) => args.message,
    });
    const set = toToolSet([echo]);
    expect(Object.keys(set)).toEqual(['echo']);
    expect(set.echo.description).toBe('Echo');
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd packages/agent && pnpm vitest run __tests__/model/message-utils.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 message-utils.ts**

```ts
// @vico/agent - 原生 ModelMessage 工具函数：文本提取、消息构造、UIMessage 转换、ToolSet 转换
import { tool } from 'ai';
import type { ModelMessage, UIMessage, ToolSet } from 'ai';
import type {
  AssistantModelMessage, ToolModelMessage, ToolResultPart, TextPart, ToolCallPart,
} from '@ai-sdk/provider-utils';
import type { Tool, ToolCall, ToolResult } from '../tool/types.js';

/**
 * 提取消息的纯文本内容（string content 直接返回，parts 拼接全部 text part）。
 */
export function getMessageText(msg: ModelMessage): string {
  if (typeof msg.content === 'string') return msg.content;
  return (msg.content as Array<{ type: string; text?: string }>)
    .filter((p) => p.type === 'text')
    .map((p) => p.text ?? '')
    .join('');
}

/**
 * 从 assistant 消息的 tool-call parts 提取 Vico ToolCall 列表。
 */
export function getToolCalls(msg: ModelMessage): ToolCall[] {
  if (msg.role !== 'assistant' || typeof msg.content === 'string') return [];
  return msg.content
    .filter((p): p is ToolCallPart => p.type === 'tool-call')
    .map((p) => ({ id: p.toolCallId, name: p.toolName, args: (p.input ?? {}) as Record<string, unknown> }));
}

/** 在消息链中查找指定 toolCallId 的 tool-result part */
function findToolResult(messages: ModelMessage[], toolCallId: string): ToolResultPart | undefined {
  for (const m of messages) {
    if (m.role !== 'tool') continue;
    for (const p of m.content) {
      if (p.type === 'tool-result' && p.toolCallId === toolCallId) return p;
    }
  }
  return undefined;
}

/**
 * 消息链中是否已存在指定 toolCallId 的工具结果（幂等恢复用）。
 */
export function hasToolResult(messages: ModelMessage[], toolCallId: string): boolean {
  return findToolResult(messages, toolCallId) !== undefined;
}

/**
 * 提取指定 toolCallId 的工具结果文本（text/error-text 直接取值，其余 JSON 序列化）。
 */
export function getToolResultText(messages: ModelMessage[], toolCallId: string): string | undefined {
  const part = findToolResult(messages, toolCallId);
  if (!part) return undefined;
  const output = part.output;
  if (output.type === 'text' || output.type === 'error-text') return output.value;
  return JSON.stringify((output as { value?: unknown }).value ?? null);
}

/**
 * 构造原生 assistant 消息：文本 + 工具调用 parts。content 数组不能为空，兜底空文本。
 */
export function buildAssistantMessage(text: string, toolCalls: ToolCall[]): AssistantModelMessage {
  const parts: Array<TextPart | ToolCallPart> = [];
  if (text) parts.push({ type: 'text', text });
  for (const tc of toolCalls) {
    parts.push({ type: 'tool-call', toolCallId: tc.id, toolName: tc.name, input: tc.args });
  }
  if (parts.length === 0) parts.push({ type: 'text', text: '' });
  return { role: 'assistant', content: parts };
}

/**
 * 构造原生 tool 消息：Vico ToolResult → tool-result part（成功 text / 失败 error-text）。
 *
 * @param result - Vico 工具执行结果
 * @param content - 已 resolve（可能截断）的结果文本
 */
export function buildToolResultMessage(result: ToolResult, content: string): ToolModelMessage {
  return {
    role: 'tool',
    content: [{
      type: 'tool-result',
      toolCallId: result.callId,
      toolName: result.name,
      output: result.status === 'success'
        ? { type: 'text', value: content }
        : { type: 'error-text', value: content },
    }],
  };
}

/**
 * ModelMessage → UIMessage（历史展示用，仅保留有文本的 system/user/assistant 消息）。
 * ai 包无官方反向转换，此处只做文本级降级转换。
 */
export function modelMessageToUIMessage(msg: ModelMessage, id: string): UIMessage | undefined {
  if (msg.role === 'tool') return undefined;
  const text = getMessageText(msg);
  if (!text) return undefined;
  return { id, role: msg.role, parts: [{ type: 'text', text }] };
}

/**
 * Vico Tool[] → ai ToolSet（供 prepareTools 转换为 provider 工具格式）。
 * 审批/策略元数据不进入 ToolSet，由 Vico loop 自行管理。
 */
export function toToolSet(tools: Tool[]): ToolSet {
  return Object.fromEntries(
    tools.map((t) => [t.name, tool({ description: t.description, inputSchema: t.inputSchema })]),
  );
}
```

- [ ] **Step 4: 运行测试通过**

Run: `cd packages/agent && pnpm vitest run __tests__/model/message-utils.test.ts`
Expected: PASS（若 `tool()` 的 zod4 schema 类型不匹配，将 `inputSchema: t.inputSchema` 改为 `inputSchema: t.inputSchema as never`，并加行注释说明 zod3/4 泛型差异）

- [ ] **Step 5: Commit**

```bash
git add packages/agent/src/model/message-utils.ts packages/agent/__tests__/model/message-utils.test.ts
git commit -m "feat: message-utils 原生 ModelMessage 工具函数集"
```

---

### Task 4: model 层重写（删 3 个转换文件，ModelClient 走 ai/internal）

**Files:**
- Modify: `packages/agent/src/model/types.ts`（重写）
- Modify: `packages/agent/src/model/model-client.ts`（重写）
- Delete: `packages/agent/src/model/prompt-converter.ts`、`tool-converter.ts`、`stream-processor.ts`
- Delete: `packages/agent/__tests__/model/stream-processor.test.ts`
- Modify: `packages/agent/__tests__/model/model-client.test.ts`（重写）

**Interfaces:**
- Consumes: Task 3 的 `toToolSet`
- Produces:
  - `ModelRequest = { system?: string; messages: ModelMessage[]; tools?: Tool[]; maxOutputTokens?: number; temperature?: number; reasoning?: ReasoningEffort; abortSignal?: AbortSignal }`
  - `ModelStreamResult = { stream: ReadableStream<LanguageModelV4StreamPart> }`
  - `ReasoningEffort = 'provider-default' | 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'`
  - `ModelClient.stream(request, abortSignal?): Promise<ModelStreamResult>`

- [ ] **Step 1: 重写 model/types.ts**

```ts
// @vico/agent - 模型模块类型定义（消息/流类型全部使用 AI SDK 原生类型）
import type { ModelMessage } from 'ai';
import type { LanguageModelV4StreamPart } from '@ai-sdk/provider';
import type { Tool } from '../tool/types.js';

/** 推理力度（透传 LanguageModelV4CallOptions.reasoning） */
export type ReasoningEffort = 'provider-default' | 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';

/** ModelClient.stream() 调用参数 */
export interface ModelRequest {
  /** 系统提示词（standardizePrompt 会合并进 instructions） */
  system?: string;
  /** 原生 AI SDK ModelMessage 消息列表 */
  messages: ModelMessage[];
  /** Vico 工具列表，内部经 toToolSet + prepareTools 转换为 provider 工具格式 */
  tools?: Tool[];
  maxOutputTokens?: number;
  temperature?: number;
  /** 推理力度，不传则 provider 默认 */
  reasoning?: ReasoningEffort;
  abortSignal?: AbortSignal;
}

/** ModelClient.stream() 返回值 — provider 原生 V4 流 */
export interface ModelStreamResult {
  stream: ReadableStream<LanguageModelV4StreamPart>;
}
```

- [ ] **Step 2: 重写 model-client.ts**

```ts
// @vico/agent - ModelClient：对 LanguageModelV4.doStream() 的薄封装层
import { standardizePrompt, convertToLanguageModelPrompt, prepareTools } from 'ai/internal';
import type { LanguageModelV4 } from '@ai-sdk/provider';
import { toToolSet } from './message-utils.js';
import type { ModelRequest, ModelStreamResult } from './types.js';

/**
 * Provider 层语言模型的薄封装。
 *
 * 用 ai/internal 积木将原生 ModelMessage / Vico Tool 转换为 provider 格式，
 * 调用 doStream()，透出原生 LanguageModelV4StreamPart 流。
 */
export class ModelClient {
  constructor(private model: LanguageModelV4) {}

  /**
   * 流式调用模型。
   *
   * @param request - 模型请求参数（原生消息、Vico 工具、采样与推理配置）
   * @param abortSignal - 中断信号
   * @returns provider 原生 V4 流
   */
  async stream(request: ModelRequest, abortSignal?: AbortSignal): Promise<ModelStreamResult> {
    // 校验并标准化消息（system 合并进 instructions）
    const standardized = await standardizePrompt({ system: request.system, messages: request.messages });

    // 原生 ModelMessage → LanguageModelV4Prompt（download 不启用，纯文本/工具场景无下载路径）
    const prompt = await convertToLanguageModelPrompt({
      prompt: standardized,
      supportedUrls: await this.model.supportedUrls,
      download: undefined,
    });

    // Vico Tool → ai ToolSet → provider 工具格式
    const tools = request.tools?.length ? await prepareTools({ tools: toToolSet(request.tools) }) : undefined;

    const result = await this.model.doStream({
      prompt,
      tools,
      maxOutputTokens: request.maxOutputTokens,
      temperature: request.temperature,
      // 不传 reasoning 字段时交给 provider 默认行为
      ...(request.reasoning ? { reasoning: request.reasoning } : {}),
      abortSignal,
    });

    return { stream: result.stream };
  }
}
```

- [ ] **Step 3: 删除 3 个转换文件及 stream-processor 测试**

```bash
git rm packages/agent/src/model/prompt-converter.ts packages/agent/src/model/tool-converter.ts packages/agent/src/model/stream-processor.ts packages/agent/__tests__/model/stream-processor.test.ts
```

- [ ] **Step 4: 重写 model-client.test.ts**

```ts
// packages/agent/__tests__/model/model-client.test.ts
import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import type { LanguageModelV4, LanguageModelV4CallOptions, LanguageModelV4StreamPart, LanguageModelV4StreamResult } from '@ai-sdk/provider';
import { ModelClient } from '../../src/model/model-client.js';
import { createTool } from '../../src/tool/create-tool.js';

/** 创建可控 doStream 的 mock LanguageModelV4 */
function createMockModel(
  doStreamFn: (opts: LanguageModelV4CallOptions) => Promise<LanguageModelV4StreamResult>,
): LanguageModelV4 {
  return {
    specificationVersion: 'v4',
    provider: 'mock',
    modelId: 'mock-model',
    supportedUrls: {},
    doGenerate: vi.fn(),
    doStream: doStreamFn,
  } as unknown as LanguageModelV4;
}

function streamOf(parts: LanguageModelV4StreamPart[]): ReadableStream<LanguageModelV4StreamPart> {
  return new ReadableStream({
    start(controller) {
      for (const p of parts) controller.enqueue(p);
      controller.close();
    },
  });
}

describe('ModelClient', () => {
  it('将 system+messages 转为 V4 prompt，工具转为 function tool，并透传采样参数', async () => {
    const doStream = vi.fn(async () => ({ stream: streamOf([]) }));
    const client = new ModelClient(createMockModel(doStream));

    const echo = createTool({
      name: 'echo', description: 'Echo', inputSchema: z.object({ message: z.string() }),
      execute: async (a) => a.message,
    });

    await client.stream({
      system: 'sys',
      messages: [{ role: 'user', content: 'hello' }],
      tools: [echo],
      maxOutputTokens: 100,
      temperature: 0.5,
      reasoning: 'low',
    });

    const opts: LanguageModelV4CallOptions = doStream.mock.calls[0][0];
    // system 进入 prompt 首条 system 消息
    expect(opts.prompt[0]).toEqual({ role: 'system', content: 'sys' });
    // user 消息转为 text part
    expect(opts.prompt[1]).toMatchObject({ role: 'user', content: [{ type: 'text', text: 'hello' }] });
    // 工具转换
    expect(opts.tools?.[0]).toMatchObject({ type: 'function', name: 'echo' });
    expect(opts.maxOutputTokens).toBe(100);
    expect(opts.temperature).toBe(0.5);
    expect(opts.reasoning).toBe('low');
  });

  it('透传 provider 原生流', async () => {
    const parts: LanguageModelV4StreamPart[] = [
      { type: 'text-start', id: 't1' },
      { type: 'text-delta', id: 't1', delta: 'hi' },
      { type: 'text-end', id: 't1' },
    ];
    const client = new ModelClient(createMockModel(async () => ({ stream: streamOf(parts) })));
    const { stream } = await client.stream({ messages: [{ role: 'user', content: 'q' }] });

    const received: LanguageModelV4StreamPart[] = [];
    for await (const chunk of stream) received.push(chunk);
    expect(received).toEqual(parts);
  });
});
```

- [ ] **Step 5: 运行 model 层测试**

Run: `cd packages/agent && pnpm vitest run __tests__/model/`
Expected: PASS（message-utils + model-client；此时全包 typecheck 仍会失败，属预期，后续 Task 消除）

- [ ] **Step 6: Commit**

```bash
git add -A packages/agent/src/model packages/agent/__tests__/model
git commit -m "refactor: model 层改用 ai/internal 积木，删除自研 prompt/tool/stream 转换器"
```

---

### Task 5: 持久化消息形态（ThreadStore Message + toModelMessages）

**Files:**
- Modify: `packages/agent/src/thread/thread-store.ts:52-63`
- Modify: `packages/agent/src/agent-loop/utils.ts:10-30`
- Modify: `packages/agent/src/memory/conversation-history-memory.ts:3`
- Modify: `packages/agent/src/thread/memory-thread-store.ts`（若其 appendEntry 引用 toolCalls 字段，同步删除）

**Interfaces:**
- Produces:
  - `Message = { id, threadId, turnId, role: string, content: string /* JSON(ModelMessage.content) */, metadata?, createdAt }`（**删除 toolCallId/toolCalls 字段**）
  - `toModelMessages(entries: Message[]): ModelMessage[]`（JSON.parse content）
  - `fromModelMessage(msg: ModelMessage): { role: string; content: string }`（序列化）

- [ ] **Step 1: 修改 thread-store.ts 的 Message 接口**

删除文件顶部 `import {ToolCall} from "../tool/types.js";`，Message 改为：

```ts
/** 对话记录条目 — content 存原生 ModelMessage.content 的 JSON 序列化（string 或 parts 数组） */
export interface Message {
  id: string;
  threadId: string;
  turnId: string;
  role: string;
  /** JSON.stringify(ModelMessage.content)，读取时 JSON.parse 还原 */
  content: string;
  /** 自定义上下文字段（JSON 可序列化） */
  metadata?: Record<string, unknown>;
  createdAt: number;
}
```

- [ ] **Step 2: 重写 utils.ts 的 toModelMessages 并新增 fromModelMessage**

替换 utils.ts 中 `toModelMessages`（原 17-30 行）及顶部相关 import（删除 `MessageRole`、`ToolCall` import，`ModelMessage` 改从 `'ai'` 导入）：

```ts
import type { ModelMessage } from 'ai';

/**
 * ThreadStore Message → 原生 ModelMessage（content 反序列化）。
 * 解析失败时按纯文本内容兜底（防御历史脏数据）。
 */
export function toModelMessages(entries: Message[]): ModelMessage[] {
  return entries.map((e) => {
    let content: unknown;
    try {
      content = JSON.parse(e.content);
    } catch {
      content = e.content;
    }
    return { role: e.role, content } as ModelMessage;
  });
}

/**
 * 原生 ModelMessage → ThreadStore 持久化字段（content 序列化）。
 */
export function fromModelMessage(msg: ModelMessage): { role: string; content: string } {
  return { role: msg.role, content: JSON.stringify(msg.content) };
}
```

- [ ] **Step 3: conversation-history-memory.ts 换 import**

```ts
import type { ModelMessage } from 'ai';
```

（原 `from '../model/types.js'` 删除，其余逻辑不变。）

- [ ] **Step 4: 检查 memory-thread-store.ts**

Run: `grep -n "toolCalls\|toolCallId" packages/agent/src/thread/memory-thread-store.ts`
若有引用，删除对应字段读写（InMemory 实现通常直接存 entry 对象，删除 Omit 中已不存在的字段即可）。

- [ ] **Step 5: 验证这批文件无类型错误**

Run: `cd packages/agent && pnpm typecheck 2>&1 | grep -E "thread-store|utils.ts|conversation-history|memory-thread-store"`
Expected: 无输出

- [ ] **Step 6: Commit**

```bash
git add packages/agent/src/thread packages/agent/src/agent-loop/utils.ts packages/agent/src/memory/conversation-history-memory.ts
git commit -m "refactor: ThreadStore Message 改存原生 content JSON，删除 toolCalls 列语义"
```

---

### Task 6: agent-loop 核心迁移（最大改动）

**Files:**
- Modify: `packages/agent/src/agent-loop/agent-loop.ts`
- Modify: `packages/agent/src/agent-loop/agent-loop-options.ts`
- Modify: `packages/agent/src/agent-loop/turn-output.ts`
- Modify: `packages/agent/src/agent-loop/tool-executor.ts:5`
- Modify: `packages/agent/src/agent-loop/context-processors/context-processor.ts`
- Modify: `packages/agent/src/agent-loop/context-processors/memory-processor.ts`
- Modify: `packages/agent/src/agent-loop/context-compactor.ts`
- Modify: `packages/agent/src/observable/turn-tracer.ts`

**Interfaces:**
- Consumes: Task 3 全部工具函数；Task 4 `ModelRequest`；Task 5 `fromModelMessage`
- Produces:
  - `TurnOutput.stream: ReadableStream<LanguageModelV4StreamPart>`
  - `TurnContext.controller: ReadableStreamDefaultController<LanguageModelV4StreamPart>`
  - 所有内部 messages 均为原生 `ModelMessage`

- [ ] **Step 1: 类型层替换（agent-loop-options.ts / turn-output.ts / tool-executor.ts / context-processor.ts）**

四个文件统一：`import {ModelMessage, ModelStreamChunk} from '../model/types.js'`（或相对路径变体）替换为：

```ts
import type { ModelMessage } from 'ai';
import type { LanguageModelV4StreamPart } from '@ai-sdk/provider';
```

并将所有 `ModelStreamChunk` 类型标注替换为 `LanguageModelV4StreamPart`（agent-loop-options.ts 的 `TurnContext.controller`、turn-output.ts 的 `stream` 字段/构造参数）。turn-output.ts `collectText()` 逻辑不变（V4 `text-delta` 同名同形）。

context-processor.ts 另需修改 `getLastUserMessage()`（原 86-91 行），用文本提取：

```ts
import { getMessageText } from '../../model/message-utils.js';

  /**
   * 获取最后一条用户消息的纯文本内容。
   */
  getLastUserMessage(): string {
    for (let i = this.messages.length - 1; i >= 0; i--) {
      const msg = this.messages[i];
      if (msg.role === 'user') return getMessageText(msg);
    }
    return '';
  }
```

- [ ] **Step 2: memory-processor.ts 的 extractFacts 用 getMessageText**

原 105-110 行改为：

```ts
    for (const msg of ctx.messages) {
      if (msg.role !== 'assistant') continue;
      const text = getMessageText(msg);
      if (!text || text.length < 10) continue;

      // 按句号、换行拆分
      const sentences = text.split(/[.\n]+/).map((s) => s.trim()).filter(Boolean);
```

顶部添加 `import { getMessageText } from '../../model/message-utils.js';`。

- [ ] **Step 3: context-compactor.ts 适配 parts content**

`estimateTokens`（原 22-29 行）：

```ts
function estimateTokens(messages: ModelMessage[]): number {
  let chars = 0;
  for (const m of messages) {
    // parts 数组按 JSON 长度估算（含 tool-call/tool-result 的结构开销）
    chars += typeof m.content === 'string' ? m.content.length : JSON.stringify(m.content).length;
  }
  return Math.ceil(chars / 4);
}
```

摘要流消费（原 66-70 行）chunk 类型同名，仅确保 `ModelMessage` 从 `'ai'` 导入。失败回退（原 73 行）改为：

```ts
      summaryContent = head.map((m) => `${m.role}: ${getMessageText(m).slice(0, 200)}`).join('\n');
```

顶部添加 `import { getMessageText } from '../model/message-utils.js';`，`import type { ModelMessage } from 'ai';`。

- [ ] **Step 4: turn-tracer.ts 构造函数用文本提取**

```ts
import { getMessageText } from '../model/message-utils.js';
import type { ModelMessage } from 'ai';

  constructor(thread: Thread, userMessage: ModelMessage) {
    this.threadId = thread.id;
    this.userMessage = getMessageText(userMessage);
    this.startTime = Date.now();
  }
```

（`create(thread, userMessage: ModelMessage, turnId)` 的参数类型同步换 `'ai'` 导入。）

- [ ] **Step 5: agent-loop.ts 逐点修改**

**5a. import 区**（原 6、10、32 行）：

```ts
// 删除: import {toToolDescriptor} from '../tool/create-tool.js';
// 删除: import {ModelMessage, ModelRequest, ModelStreamChunk} from '../model/types.js';
import type { ModelMessage } from 'ai';
import type { LanguageModelV4StreamPart } from '@ai-sdk/provider';
import type { ModelRequest } from '../model/types.js';
import { toModelMessages, fromModelMessage } from './utils.js';   // 原有 toModelMessages import 行合并
import { getMessageText, buildAssistantMessage, buildToolResultMessage, hasToolResult, getToolResultText } from '../model/message-utils.js';
```

**5b. run() 的流类型**（原 90、115、152、184 行）：`ReadableStream<ModelStreamChunk>` / `ReadableStreamDefaultController<ModelStreamChunk>` → `LanguageModelV4StreamPart`。

**5c. startTurn 标题**（原 125 行）：

```ts
      const title = getMessageText(userMessage).slice(0, 50);
```

**5d. resumeTurn 工具结果还原**（原 211-218 行）：

```ts
    for (const result of checkpoint.completedToolResults) {
      if (!hasToolResult(messages, result.callId)) {
        const content = this.resolveToolResult(result);
        const msg = buildToolResultMessage(result, content);
        messages.push(msg);
        await this.persistMessage(msg, context);
      }
    }
```

**5e. resolvePendingTool 并发保护**（原 302-321 行）：

```ts
    // 检查消息链中是否已有此 toolCall 的 tool_result（并发保护）
    if (hasToolResult(messages, pending.id)) {
      // 跳过执行，从消息链提取已有结果并更新 checkpoint
      const existingResult: ToolResult = {
        callId: pending.id,
        name: pending.name,
        status: 'success',
        output: getToolResultText(messages, pending.id) ?? null,
      };
      await this.checkpointStore.save(turnId, threadId, {
        completedToolCallIds: [...checkpoint.completedToolCallIds, pending.id],
        completedToolResults: [...checkpoint.completedToolResults, existingResult],
        pendingToolCall: null,
      });
      return;
    }
```

**5f. executeModelStep 的 assistant 消息**（原 477-482 行）：

```ts
    // 模型输出后的消息处理（text + tool-call parts 组装为原生 assistant 消息）
    if (modelResult.text || modelResult.toolCalls.length > 0) {
      const assistantMsg = buildAssistantMessage(modelResult.text, modelResult.toolCalls);
      context.messages.push(assistantMsg);

      await this.persistMessage(assistantMsg, context);
    }
```

**5g. resolveToolApprovals 的审批请求 chunk**（原 560-566 行）——V4 part 无 toolName/input 字段，enqueue 只带 approvalId/toolCallId（TurnEvent 照旧带全量信息）：

```ts
        // use toolCallId as approvalId so the client’s tool-approval-response maps directly
        context.controller.enqueue({
          type: 'tool-approval-request',
          approvalId: call.id,
          toolCallId: call.id,
        });
```

**5h. persistMessage**（原 591-600 行）：

```ts
  /**
   * 持久化单条消息到 threadStore（原生 content 序列化为 JSON）。
   */
  async persistMessage(message: ModelMessage, context: TurnContext): Promise<void> {
    await this.agent.thread.appendEntry({
      threadId: context.session.thread.id,
      turnId: context.session.turn.id,
      ...fromModelMessage(message),
    });
  }
```

**5i. appendToolResults**（原 617-625 行）：

```ts
  /** 工具结果 → 原生 tool 消息 + 持久化 */
  async appendToolResults(toolResults: ToolResult[], context: TurnContext): Promise<void> {
    for (const r of toolResults) {
      const content = this.resolveToolResult(r);
      const message = buildToolResultMessage(r, content);
      context.messages.push(message);
      await this.persistMessage(message, context);
    }
  }
```

**5j. callModel**（原 644-746 行）——request 组装与 chunk switch：

```ts
    const request: ModelRequest = {
      system: ctx.systemPrompt,
      messages: step.messages,
      tools: ctx.tools,
      maxOutputTokens: this.agent.maxTokens,
      temperature: this.agent.temperature,
      reasoning: this.agent.reasoning,
    };
```

switch 中：
- `case 'tool-call'` 改为（V4 input 是 JSON 字符串，内联解析）：

```ts
            case 'tool-call': {
              controller.enqueue(chunk);
              // V4 tool-call 的 input 为 JSON 字符串，解析失败时兜底空对象并告警
              let args: Record<string, unknown>;
              try {
                args = chunk.input ? JSON.parse(chunk.input) as Record<string, unknown> : {};
              } catch {
                this.log.warn({ toolCallId: chunk.toolCallId, input: chunk.input }, 'tool-call input JSON 解析失败');
                args = {};
              }
              toolCalls.push({ id: chunk.toolCallId, name: chunk.toolName, args });
              this.emit({ type: 'tool-call-start', id: chunk.toolCallId, name: chunk.toolName, args });
              break;
            }
```

- 透传组（原 672-679 行）追加 V4 新变体：

```ts
            case 'text-start':
            case 'text-end':
            case 'tool-input-start':
            case 'tool-input-delta':
            case 'tool-input-end':
            case 'tool-result':
            case 'file':
            case 'source':
            case 'custom':
            case 'reasoning-file':
              controller.enqueue(chunk);
              break;
```

- `case 'finish'` 中 usage 读取不变（V4 Usage 与 V3 同构：`chunk.usage.inputTokens.total` / `chunk.usage.outputTokens.total`）。

- [ ] **Step 6: 验证 agent-loop 相关文件无类型错误**

Run: `cd packages/agent && pnpm typecheck 2>&1 | grep -E "agent-loop|context-|turn-tracer|tool-executor|turn-output"`
Expected: 无输出（agent.ts/create-agent.ts/stream 的错误留待下个 Task）

- [ ] **Step 7: Commit**

```bash
git add packages/agent/src/agent-loop packages/agent/src/observable/turn-tracer.ts
git commit -m "refactor: agent-loop 全面切换原生 ModelMessage 与 V4 流词汇"
```

---

### Task 7: Agent 入口（UserMessage、reasoning 配置）

**Files:**
- Modify: `packages/agent/src/agent-loop/agent.ts`
- Modify: `packages/agent/src/agent-loop/create-agent.ts`
- Modify: `packages/agent/src/stream/types.ts`

**Interfaces:**
- Consumes: `convertToModelMessages`、`validateUIMessages`（ai）
- Produces:
  - `UserMessage = string | UIMessage[]`
  - `Agent.stream(message, options?): Promise<TurnOutput>`（**由同步改为 async**）
  - `AgentOptions.reasoning?: ReasoningEffort`、`AgentConfig.reasoning?: ReasoningEffort`、`Agent.reasoning?: ReasoningEffort`

- [ ] **Step 1: stream/types.ts 删除镜像类型**

整个文件替换为：

```ts
// @vico/agent - UI 流类型（直接复用 AI SDK 原生类型）
import type { UIMessage } from 'ai';

/** Agent.stream/invoke 接受的消息类型：纯文本字符串或原生 UIMessage 数组 */
export type UserMessage = string | UIMessage[];
```

（`UIMessagePart`、`UIMessage` 镜像、`UIStreamChunk` 全部删除。）

- [ ] **Step 2: agent.ts 修改**

- import：`LanguageModelV3` → `LanguageModelV4`；新增 `import { convertToModelMessages, validateUIMessages } from 'ai';`、`import type { ReasoningEffort } from '../model/types.js';`
- `AgentOptions` 增加字段（`temperature` 之后）：

```ts
  /** 推理力度，不传则 provider 默认 */
  reasoning?: ReasoningEffort;
```

- `Agent` 类：`readonly model: LanguageModelV4;`、新增 `readonly reasoning?: ReasoningEffort;`，构造函数加 `this.reasoning = params.reasoning;`
- `invoke`/`stream`/`run` 改为：

```ts
  async invoke(message: UserMessage, options?: RunOptions<TMetadata>): Promise<TurnResult> {
    const output = await this.run(message, options);
    return output.result;
  }

  /**
   * 流式对话 — 返回 TurnOutput，含 ReadableStream 流和 result Promise。
   * UIMessage[] 入参会先校验并转换为原生 ModelMessage。
   */
  stream(message: UserMessage, options?: RunOptions<TMetadata>): Promise<TurnOutput> {
    return this.run(message, options);
  }

  /**
   * 构造用户消息并启动 AgentLoop runTurn。
   * string → 单条 user 消息；UIMessage[] → validateUIMessages + convertToModelMessages 后取最后一条。
   */
  private async run(message: UserMessage, options?: RunOptions<TMetadata>): Promise<TurnOutput> {
    let userMessage: ModelMessage;
    if (typeof message === 'string') {
      userMessage = { role: 'user', content: message };
    } else {
      const validated = await validateUIMessages({ messages: message });
      const converted = await convertToModelMessages(validated, { ignoreIncompleteToolCalls: true });
      // 历史由 Memory 注入，此处只取转换结果的最后一条作为本轮用户消息
      userMessage = converted[converted.length - 1] ?? { role: 'user', content: '' };
    }
    return this.loop.run(userMessage, {
      ...(options ?? {}),
      workspace: options?.workspace ?? this.workspace,
    });
  }
```

（`ModelMessage` import 改从 `'ai'`。）

- [ ] **Step 3: create-agent.ts 修改**

- `LanguageModelV3` → `LanguageModelV4`（import、`LanguageModelFactory`、`AgentConfig.model`）
- `AgentConfig` 增加 `reasoning?: ReasoningEffort;`（import from `../model/types.js`）
- `new Agent({...})` 传参加 `reasoning: config.reasoning,`

- [ ] **Step 4: 验证**

Run: `cd packages/agent && pnpm typecheck 2>&1 | grep -E "agent.ts|create-agent|stream/types"`
Expected: 无输出

- [ ] **Step 5: Commit**

```bash
git add packages/agent/src/agent-loop/agent.ts packages/agent/src/agent-loop/create-agent.ts packages/agent/src/stream/types.ts
git commit -m "refactor: Agent 入参改原生 UIMessage[]，新增 reasoning 配置，模型类型迁移 V4"
```

---

### Task 8: turn-stream 重写 + 删除 sse.ts（TDD）

**Files:**
- Modify: `packages/agent/src/stream/turn-stream.ts`（重写）
- Delete: `packages/agent/src/stream/sse.ts`
- Test: `packages/agent/__tests__/stream/turn-stream.test.ts`（新建或重写）

**Interfaces:**
- Consumes: `TurnOutput`（V4 流）、`createUIMessageStream`/`createUIMessageStreamResponse`（ai）、`asLanguageModelUsage`（ai/internal）
- Produces: `turnOutputToSSEResponse(output: TurnOutput, options?: { onFinish?: (finish: Extract<UIMessageChunk, {type:'finish'}>, fullText: string) => void | Promise<void> }): Response`（**签名保留但不再是 async**——createUIMessageStreamResponse 同步返回 Response；vico/server 调用处 `return turnOutputToSSEResponse(...)` 兼容）

- [ ] **Step 1: 写失败测试**

```ts
// packages/agent/__tests__/stream/turn-stream.test.ts
import { describe, it, expect } from 'vitest';
import type { LanguageModelV4StreamPart } from '@ai-sdk/provider';
import type { UIMessageChunk } from 'ai';
import { TurnOutput } from '../../src/agent-loop/turn-output.js';
import { turnOutputToSSEResponse } from '../../src/stream/turn-stream.js';
import type { TurnResult } from '../../src/agent-loop/agent-loop-options.js';

function makeOutput(parts: LanguageModelV4StreamPart[], result: Partial<TurnResult> = {}): TurnOutput {
  const stream = new ReadableStream<LanguageModelV4StreamPart>({
    start(c) { for (const p of parts) c.enqueue(p); c.close(); },
  });
  const turnResult = {
    status: 'completed', steps: 1, usage: { input: 0, output: 0 },
    messages: [], thread: { id: 'th' }, turn: { id: 'tu' },
    ...result,
  } as TurnResult;
  return new TurnOutput(stream, Promise.resolve(turnResult), () => {});
}

/** 读取 SSE Response，解析出 UIMessageChunk 数组 */
async function readChunks(res: Response): Promise<UIMessageChunk[]> {
  const text = await res.text();
  return text.split('\n\n').filter(Boolean)
    .map((l) => l.replace(/^data: /, ''))
    .filter((l) => l !== '[DONE]')
    .map((l) => JSON.parse(l) as UIMessageChunk);
}

describe('turnOutputToSSEResponse', () => {
  it('文本流映射为 start/start-step/text-*/finish-step/finish', async () => {
    const res = turnOutputToSSEResponse(makeOutput([
      { type: 'text-start', id: 't1' },
      { type: 'text-delta', id: 't1', delta: 'hi' },
      { type: 'text-end', id: 't1' },
      { type: 'finish', usage: { inputTokens: { total: 3, noCache: 3, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 2, text: 2, reasoning: 0 } }, finishReason: { unified: 'stop', raw: 'stop' } },
    ]));
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const chunks = await readChunks(res);
    const types = chunks.map((c) => c.type);
    expect(types).toEqual(['start', 'start-step', 'text-start', 'text-delta', 'text-end', 'finish-step', 'finish']);
    const finish = chunks.at(-1) as Extract<UIMessageChunk, { type: 'finish' }>;
    expect(finish.finishReason).toBe('stop');
    // usage 经 asLanguageModelUsage 扁平化后挂在 messageMetadata.custom.usage
    expect((finish.messageMetadata as { custom: { usage: { inputTokens: number } } }).custom.usage.inputTokens).toBe(3);
  });

  it('tool-call 映射 tool-input-available 且 input 已解析；tool-result 映射 tool-output-available', async () => {
    const chunks = await readChunks(turnOutputToSSEResponse(makeOutput([
      { type: 'tool-input-start', id: 'c1', toolName: 'echo' },
      { type: 'tool-input-delta', id: 'c1', delta: '{"x":1}' },
      { type: 'tool-call', toolCallId: 'c1', toolName: 'echo', input: '{"x":1}' },
      { type: 'tool-result', toolCallId: 'c1', toolName: 'echo', result: 'ok' },
    ])));
    expect(chunks).toContainEqual({ type: 'tool-input-start', toolCallId: 'c1', toolName: 'echo' });
    expect(chunks).toContainEqual({ type: 'tool-input-delta', toolCallId: 'c1', inputTextDelta: '{"x":1}' });
    expect(chunks).toContainEqual({ type: 'tool-input-available', toolCallId: 'c1', toolName: 'echo', input: { x: 1 } });
    expect(chunks).toContainEqual({ type: 'tool-output-available', toolCallId: 'c1', output: 'ok' });
  });

  it('paused 结果发出 data-turn-paused，审批请求透传', async () => {
    const chunks = await readChunks(turnOutputToSSEResponse(makeOutput(
      [{ type: 'tool-approval-request', approvalId: 'c1', toolCallId: 'c1' }],
      { status: 'paused' },
    )));
    expect(chunks).toContainEqual({ type: 'tool-approval-request', approvalId: 'c1', toolCallId: 'c1' });
    expect(chunks.some((c) => c.type === 'data-turn-paused')).toBe(true);
  });

  it('custom 与 reasoning-file 走原生 UI chunk', async () => {
    const chunks = await readChunks(turnOutputToSSEResponse(makeOutput([
      { type: 'custom', kind: 'openai.annotation' },
      { type: 'reasoning-file', mediaType: 'image/png', data: { type: 'url', url: new URL('https://x.test/a.png') } },
    ])));
    expect(chunks).toContainEqual({ type: 'custom', kind: 'openai.annotation' });
    expect(chunks).toContainEqual({ type: 'reasoning-file', url: 'https://x.test/a.png', mediaType: 'image/png' });
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd packages/agent && pnpm vitest run __tests__/stream/turn-stream.test.ts`
Expected: FAIL

- [ ] **Step 3: 重写 turn-stream.ts**

```ts
/**
 * TurnOutput（LanguageModelV4StreamPart 流）→ AI SDK UIMessageChunk SSE 响应。
 * 复用 createUIMessageStream / createUIMessageStreamResponse，供 @assistant-ui/react 原生消费。
 */
import { createUIMessageStream, createUIMessageStreamResponse } from 'ai';
import type { UIMessageChunk } from 'ai';
import { asLanguageModelUsage } from 'ai/internal';
import type { LanguageModelV4Usage } from '@ai-sdk/provider';
import type { TurnOutput } from '../agent-loop/turn-output.js';
import type { TurnResult } from '../agent-loop/agent-loop-options.js';

/** V4 tool-call 的 input 是 JSON 字符串，解析失败时原样透传 */
function safeParseJson(input: unknown): unknown {
  if (typeof input !== 'string') return input ?? {};
  try {
    return JSON.parse(input || '{}');
  } catch {
    return input;
  }
}

/** V4 文件数据（data/url 两种变体）→ 可展示 URL（url 直用，data 转 base64 data URI） */
function toFileUrl(data: { type: 'data'; data: Uint8Array | string } | { type: 'url'; url: URL }, mediaType: string): string {
  if (data.type === 'url') return data.url.href;
  const base64 = typeof data.data === 'string' ? data.data : Buffer.from(data.data).toString('base64');
  return `data:${mediaType};base64,${base64}`;
}

/**
 * TurnOutput → SSE Response（AI SDK UI Message Stream 协议）。
 *
 * @param output - TurnOutput 实例，包含 V4 流和结果 Promise
 * @param options - 可选配置，onFinish 可在 finish chunk 发出前修改 messageMetadata
 * @returns SSE 格式的 Response 对象
 */
export function turnOutputToSSEResponse(
  output: TurnOutput,
  options?: { onFinish?: (finish: Extract<UIMessageChunk, { type: 'finish' }>, fullText: string) => void | Promise<void> },
): Response {
  const stream = createUIMessageStream({
    execute: async ({ writer }) => {
      let fullText = '';
      /** 从 model finish part 中捕获的 token 用量 */
      let modelUsage: LanguageModelV4Usage | undefined;
      let inStep = false;

      writer.write({ type: 'start' });

      const reader = output.stream.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          switch (value.type) {
            // ── 透传：V4 part 与 UIMessageChunk 同名同形 ──
            case 'text-start':
              if (!inStep) { writer.write({ type: 'start-step' }); inStep = true; }
              writer.write(value);
              break;

            case 'text-delta':
              fullText += value.delta;
              writer.write(value);
              break;

            case 'text-end':
            case 'reasoning-start':
            case 'reasoning-delta':
            case 'reasoning-end':
            case 'custom':
              writer.write(value);
              break;

            // ── 字段映射 ──
            case 'tool-input-start':
              writer.write({ type: 'tool-input-start', toolCallId: value.id, toolName: value.toolName });
              break;

            case 'tool-input-delta':
              writer.write({ type: 'tool-input-delta', toolCallId: value.id, inputTextDelta: value.delta });
              break;

            case 'tool-input-end':
              break;

            case 'tool-call':
              writer.write({ type: 'tool-input-available', toolCallId: value.toolCallId, toolName: value.toolName, input: safeParseJson(value.input) });
              break;

            case 'tool-result':
              if (value.isError) {
                writer.write({ type: 'tool-output-error', toolCallId: value.toolCallId, errorText: String(value.result) });
              } else {
                writer.write({ type: 'tool-output-available', toolCallId: value.toolCallId, output: value.result });
              }
              break;

            case 'tool-approval-request':
              writer.write({ type: 'tool-approval-request', approvalId: value.approvalId, toolCallId: value.toolCallId });
              break;

            case 'source':
              if (value.sourceType === 'url') {
                writer.write({ type: 'source-url', sourceId: value.id, url: value.url, title: value.title, providerMetadata: value.providerMetadata });
              } else {
                writer.write({ type: 'source-document', sourceId: value.id, mediaType: value.mediaType, title: value.title, filename: value.filename, providerMetadata: value.providerMetadata });
              }
              break;

            case 'file':
              writer.write({ type: 'file', url: toFileUrl(value.data, value.mediaType), mediaType: value.mediaType, providerMetadata: value.providerMetadata });
              break;

            case 'reasoning-file':
              writer.write({ type: 'reasoning-file', url: toFileUrl(value.data, value.mediaType), mediaType: value.mediaType, providerMetadata: value.providerMetadata });
              break;

            case 'response-metadata':
              writer.write({ type: 'message-metadata', messageMetadata: { modelId: value.modelId, timestamp: value.timestamp } });
              break;

            case 'finish':
              modelUsage = value.usage;
              break;

            case 'error':
              writer.write({ type: 'error', errorText: value.error instanceof Error ? value.error.message : String(value.error) });
              break;

            default:
              // stream-start / raw：内部使用，不透出
              break;
          }
        }
      } finally {
        reader.releaseLock();
      }

      const result: TurnResult = await output.result;

      if (result.status === 'aborted') {
        writer.write({ type: 'abort' });
      }
      if (result.status === 'paused') {
        // Vico 自定义事件走原生 data-* 通道
        writer.write({ type: 'data-turn-paused', data: { reason: 'tool-approval', turnId: result.turn.id }, transient: true } as UIMessageChunk);
      }
      if (inStep) {
        writer.write({ type: 'finish-step' });
      }

      const finish: Extract<UIMessageChunk, { type: 'finish' }> = {
        type: 'finish',
        finishReason: result.status === 'completed' || result.status === 'paused' ? 'stop' : 'error',
        // usage 用 ai/internal 的 asLanguageModelUsage 扁平化
        messageMetadata: modelUsage ? { custom: { usage: asLanguageModelUsage(modelUsage) } } : undefined,
      };
      await options?.onFinish?.(finish, fullText);
      writer.write(finish);
    },
    onError: (e) => (e instanceof Error ? e.message : String(e)),
  });

  return createUIMessageStreamResponse({ stream });
}
```

- [ ] **Step 4: 删除 sse.ts**

```bash
git rm packages/agent/src/stream/sse.ts
```

（若存在 `__tests__/stream/sse.test.ts` 一并 `git rm`。）

- [ ] **Step 5: 运行测试通过**

Run: `cd packages/agent && pnpm vitest run __tests__/stream/turn-stream.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add -A packages/agent/src/stream packages/agent/__tests__/stream
git commit -m "refactor: turn-stream 改用 createUIMessageStream 出原生 SSE，删除自研 sse.ts"
```

---

### Task 9: index.ts 导出面 + agent 包全绿

**Files:**
- Modify: `packages/agent/src/index.ts`
- Modify: `packages/agent/src/tool/create-tool.ts`（删 toToolDescriptor）
- Modify: `packages/agent/__tests__/agent-loop.test.ts`、`agent-loop-checkpoint.test.ts`、`agent-runtime.test.ts`（mock 迁移）

**Interfaces:**
- Produces: `@vico/agent` 公共导出——原生 `ModelMessage`/`UIMessage`/`UIMessageChunk` re-export、message-utils 全量、`ReasoningEffort`；删除 `ModelStreamChunk`/`UIStreamChunk`/`ToolDescriptor`/`toToolDescriptor`/`createSSEResponse`/`MessageRole`/`UIMessagePart` 导出

- [ ] **Step 1: create-tool.ts 删除 toToolDescriptor**

删除 `toToolDescriptor` 函数（原 66-77 行）、顶部 `import type {ToolDescriptor} from '../model/types.js';`，以及不再使用的 `import {z}`（若仅 toToolDescriptor 使用 z.toJSONSchema —— 注意 createTool 的类型标注仍用 `z.ZodType`，保留 `import type {z}`，将值导入改为类型导入）。

- [ ] **Step 2: index.ts 更新导出**

Model 段（原 16-29 行）替换为：

```ts
// Ports — Model（消息/流类型全部 re-export AI SDK 原生类型）
export type { ModelMessage, UIMessage, UIMessageChunk, ToolSet } from 'ai';
export { convertToModelMessages, validateUIMessages } from 'ai';
export { createLanguageModel } from './model/factory.js';

// ModelClient and types
export { ModelClient } from './model/model-client.js';
export type { ModelRequest, ModelStreamResult, ReasoningEffort } from './model/types.js';
export {
  getMessageText, getToolCalls, hasToolResult, getToolResultText,
  buildAssistantMessage, buildToolResultMessage, modelMessageToUIMessage, toToolSet,
} from './model/message-utils.js';
```

- Tool 段：`export { createTool, toToolDescriptor, type ToolOptions }` → `export { createTool, type ToolOptions }`
- Stream 段：删除 `UIStreamChunk`/`UIMessagePart` 及自定义 `UIMessage` 的导出、删除 `createSSEResponse` 导出行；保留 `export type { UserMessage } from './stream/types.js';` 与 `turnOutputToSSEResponse`
- 全文件搜查残留：`grep -n "ModelStreamChunk\|ToolDescriptor\|MessageRole\|createSSEResponse\|UIStreamChunk\|UIMessagePart" packages/agent/src/index.ts` 应无输出

- [ ] **Step 3: 迁移三个测试文件的 mock**

`agent-loop.test.ts` / `agent-loop-checkpoint.test.ts`：

```ts
// import 替换
import type { LanguageModelV4, LanguageModelV4StreamResult } from '@ai-sdk/provider';

/** Create a mock LanguageModelV4 whose doStream yields given stream parts */
function createMockModel(chunks: any[]): LanguageModelV4 {
  return {
    specificationVersion: 'v4',
    provider: 'mock',
    modelId: 'mock-model',
    supportedUrls: {},   // convertToLanguageModelPrompt 需要，缺失会抛错
    doGenerate: async () => { throw new Error('not implemented'); },
    doStream: async () => ({
      stream: new ReadableStream({
        start(controller) {
          for (const c of chunks) controller.enqueue(c);
          controller.close();
        },
      }),
    } satisfies LanguageModelV4StreamResult),
  } as unknown as LanguageModelV4;
}
```

统一替换规则（两个文件内全部出现处）：
- `LanguageModelV3` → `LanguageModelV4`；`specificationVersion: 'v3'` → `'v4'`；mock 对象补 `supportedUrls: {}`
- mock chunks 中 `tool-call` 的 `input` 若是对象改为 JSON 字符串（如 `input: '{"x":1}'`），与 V4 spec 一致
- 断言消息内容处：`msg.content === 'xxx'` 形式改为 `getMessageText(msg) === 'xxx'`（从 `../src/model/message-utils.js` 导入）；断言 `toolCalls` 字段处改用 `getToolCalls(msg)`
- `agent.stream(...)` 调用处补 `await`（签名已改 async）

`agent-runtime.test.ts`：`const mockLM: LanguageModelV4 = 'mock-model' as unknown as LanguageModelV4;`

- [ ] **Step 4: 全包验证**

Run: `cd packages/agent && pnpm typecheck`
Expected: 通过，0 错误

Run: `cd packages/agent && pnpm test`
Expected: 全部 PASS。若个别断言因消息形态失败，按"content 为 parts 数组"的新形态修正断言（用 getMessageText/getToolCalls），不修改 src 实现。

- [ ] **Step 5: Commit**

```bash
git add -A packages/agent
git commit -m "refactor: @vico/agent 公共导出切换原生类型，测试迁移 V4 mock，全包 typecheck/test 通过"
```

---

### Task 10: libsql-adapter 适配

**Files:**
- Modify: `packages/libsql-adapter/src/schema.ts`
- Modify: `packages/libsql-adapter/src/libsql-thread-store.ts`
- Modify: `packages/libsql-adapter/src/migrate.ts`

- [ ] **Step 1: schema.ts 消息表删除工具列**

```ts
/** 消息 — content 存原生 ModelMessage.content 的 JSON 序列化 */
export const messages = sqliteTable('vico_messages', {
  id: text('id').primaryKey(),
  thread_id: text('thread_id').notNull(),
  turn_id: text('turn_id').notNull(),
  role: text('role').notNull(),
  content: text('content').notNull(),
  metadata: text('metadata'),
  created_at: integer('created_at').notNull(),
});
```

- [ ] **Step 2: libsql-thread-store.ts 读写映射**

顶部 import 删除 `ToolCall`。appendEntry：

```ts
  async appendEntry(
    entry: Omit<Message, 'id' | 'createdAt'>,
  ): Promise<Message> {
    const id = crypto.randomUUID();
    const now = Date.now();
    await this.db.insert(messages).values({
      id,
      thread_id: entry.threadId,
      turn_id: entry.turnId,
      role: entry.role,
      content: entry.content,
      metadata: entry.metadata ? JSON.stringify(entry.metadata) : null,
      created_at: now,
    });
    return { ...entry, id, createdAt: now };
  }
```

_toMessage：

```ts
  private _toMessage(r: typeof messages.$inferSelect): Message {
    return {
      id: r.id,
      threadId: r.thread_id,
      turnId: r.turn_id,
      role: r.role,
      content: r.content,
      metadata: r.metadata ? (JSON.parse(r.metadata) as Record<string, unknown>) : undefined,
      createdAt: r.created_at,
    };
  }
```

- [ ] **Step 3: migrate.ts 更新建表 SQL**

```ts
  // 消息表（content 存原生 ModelMessage.content JSON；不兼容旧库，重建即可）
  await db.run(sql`
    CREATE TABLE IF NOT EXISTS vico_messages (
      id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      turn_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      metadata TEXT,
      created_at INTEGER NOT NULL
    )
  `);
```

（索引语句不变。）

- [ ] **Step 4: 验证**

Run: `cd packages/libsql-adapter && pnpm typecheck && pnpm test 2>/dev/null || pnpm typecheck`
Expected: typecheck 通过；若有测试引用 toolCalls 字段，同步删除相关断言。

- [ ] **Step 5: Commit**

```bash
git add packages/libsql-adapter
git commit -m "refactor(libsql-adapter): 消息表删除 tool_calls 列，content 存原生 JSON"
```

---

### Task 11: mysql-adapter 适配

**Files:**
- Modify: `packages/mysql-adapter/src/schema.ts`
- Modify: `packages/mysql-adapter/src/mysql-thread-store.ts`
- Modify: `packages/mysql-adapter/src/migrate.ts`

- [ ] **Step 1: schema.ts**

```ts
/** messages — content 存原生 ModelMessage.content 的 JSON 序列化 */
export const messages = mysqlTable('vico_messages', {
  id: varchar('id', { length: 36 }).primaryKey(),
  thread_id: varchar('thread_id', { length: 36 }).notNull(),
  turn_id: varchar('turn_id', { length: 36 }).notNull(),
  role: varchar('role', { length: 36 }).notNull(),
  content: text('content').notNull(),
  metadata: json('metadata'),
  created_at: bigint('created_at', { mode: 'number' }).notNull(),
});
```

- [ ] **Step 2: mysql-thread-store.ts**

appendEntry 的 values 删除 `tool_call_id`/`tool_calls` 两行；_toMessage 删除 `toolCallId`/`toolCalls` 两行；顶部 import 删除 `ToolCall`。

- [ ] **Step 3: migrate.ts 建表 SQL（顺带补上 schema 中已有但建表缺失的 metadata 列）**

```ts
  // Messages table（content 存原生 ModelMessage.content JSON）
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS vico_messages (
      id VARCHAR(36) PRIMARY KEY,
      thread_id VARCHAR(36) NOT NULL,
      turn_id VARCHAR(36) NOT NULL,
      role VARCHAR(36) NOT NULL,
      content TEXT NOT NULL,
      metadata JSON,
      created_at BIGINT NOT NULL,
      KEY idx_msg_thread (thread_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
```

- [ ] **Step 4: 验证 + Commit**

Run: `cd packages/mysql-adapter && pnpm typecheck`
Expected: 通过

```bash
git add packages/mysql-adapter
git commit -m "refactor(mysql-adapter): 消息表删除 tool_calls 列，content 存原生 JSON，建表补 metadata 列"
```

---

### Task 12: vico/server 适配

**Files:**
- Modify: `vico/server/src/api/chat.ts`
- Modify: `vico/server/src/chat/chat.ts`
- Modify: `vico/server/src/services/conversation/conversation-manager.ts`

**Interfaces:**
- Consumes: `Agent.stream(message: string | UIMessage[], opts): Promise<TurnOutput>`、`getMessageText`（@vico/agent）
- Produces: `executeAgentChat({..., message: string | UIMessage[]})`；REST 响应形状不变（MessageItem.content 为纯文本，tool_calls 字段删除）

- [ ] **Step 1: api/chat.ts 用原生 UIMessage 解析请求**

删除自定义 `AISDKMessagePart`/`AISDKMessage` 接口，替换 extract 函数：

```ts
import type { UIMessage } from 'ai';

/** 从请求体提取最后一条 user UIMessage */
function extractLastUserMessage(body: Record<string, unknown>): UIMessage | undefined {
  const messages = body.messages as UIMessage[] | undefined;
  if (!messages?.length) return undefined;
  return messages.filter((m) => m.role === 'user').pop();
}

/** 提取消息文本（判断本次请求是否携带用户输入） */
function extractText(msg: UIMessage | undefined): string {
  if (!msg) return '';
  return msg.parts
    .filter((p): p is Extract<UIMessage['parts'][number], { type: 'text' }> => p.type === 'text')
    .map((p) => p.text)
    .join('');
}

/** 从消息 parts 中提取审批决策（tool-approval-response 为客户端扩展 part） */
function extractApprovalDecisions(msg: UIMessage | undefined): ToolApproval[] | undefined {
  if (!msg) return undefined;
  const approvalParts = (msg.parts as Array<{ type: string; approvalId?: string; approved?: boolean }>)
    .filter((p) => p.type === 'tool-approval-response' && p.approvalId);
  if (!approvalParts.length) return undefined;
  return approvalParts.map((p) => ({ toolCallId: p.approvalId!, approved: p.approved ?? false }));
}
```

`/api/v1/chat` handler 主体对应改为：

```ts
    const body = await c.req.json();
    const agentId: string | undefined = body.agentId;
    const lastUserMessage = extractLastUserMessage(body);
    const messageText = extractText(lastUserMessage);
    const requestedThreadId: string | undefined = body.threadId as string;

    const isLocalThreadId = requestedThreadId?.startsWith('__LOCALID_') ?? false;
    const threadId = isLocalThreadId ? crypto.randomUUID() : requestedThreadId;

    // 仅审批响应（无文本）时走恢复路径
    const approvalDecisions = messageText ? undefined : extractApprovalDecisions(lastUserMessage);

    if (!agentId || (!messageText && !approvalDecisions?.length) || !requestedThreadId) {
      return c.json({ error: 'agentId, message and threadId are required' }, 400);
    }

    try {
      const stream = await executeAgentChat({
        agentId,
        // 原生 UIMessage[] 直接下传（agent 内部 convertToModelMessages）
        message: lastUserMessage && messageText ? [lastUserMessage] : '',
        threadId,
        tenantId: auth.tenantId,
        userId: auth.userId,
        approvalDecisions,
      });

      return turnOutputToSSEResponse(stream, {
        onFinish: (finish) => {
          finish.messageMetadata = { ...(finish.messageMetadata as object), threadId };
        },
      });
    } catch (error: unknown) {
      // ...（原样保留）
```

`/chat/resume` 路由不变（message 传 `''`）。

- [ ] **Step 2: chat/chat.ts 放宽 message 类型**

```ts
import type { ToolApproval, TurnOutput, UserMessage } from '@vico/agent';

export interface ExecuteChatParams {
  agentId: string;
  /** 用户消息：纯文本或原生 UIMessage[]（审批恢复时可为空串） */
  message: UserMessage;
  threadId: string;
  tenantId: string;
  userId: string;
  approvalDecisions?: ToolApproval[];
}
```

守卫条件改为：

```ts
  const hasMessage = typeof message === 'string' ? !!message.trim() : message.length > 0;
  if (!hasMessage && !approvalDecisions?.length) throw new Error('Message is required');
```

（`agent.stream` 已是 async，`return agent.stream(...)` 返回 Promise<TurnOutput>，签名不变。）

- [ ] **Step 3: conversation-manager.ts 换 getMessageText**

```ts
import { getMessageText, type Message, type ModelMessage, type ThreadStore } from '@vico/agent';

/**
 * 从持久化消息中提取纯文本（content 为原生 ModelMessage.content 的 JSON）。
 */
function extractMessageText(msg: Message): string {
  try {
    return getMessageText({ role: msg.role, content: JSON.parse(msg.content) } as ModelMessage);
  } catch {
    return msg.content;
  }
}
```

getById 的 MessageItem 映射删除 `tool_calls` 行：

```ts
    const messages: MessageItem[] = entries.map((msg: Message) => ({
      id: msg.id,
      thread_id: msg.threadId ?? id,
      role: ['user', 'assistant', 'system'].includes(msg.role) ? msg.role : 'system',
      content: extractMessageText(msg),
      token_usage: 0,
      created_at: msg.createdAt ?? Date.now(),
    }));
```

同步：`services/conversation/types.ts` 的 `MessageItem` 删除 `tool_calls?: string;` 字段；文件内其他 `extractMessageText` 调用处（recent 预览）自动生效。

- [ ] **Step 4: 验证**

Run: `cd vico/server && pnpm typecheck 2>/dev/null || npx tsc --noEmit`
Expected: 通过（若 server 无 typecheck script，用 tsc --noEmit）

- [ ] **Step 5: Commit**

```bash
git add vico/server
git commit -m "refactor(server): chat 路由改原生 UIMessage 解析，历史文本提取用 getMessageText"
```

---

### Task 13: 全链路验证 + 文档沉淀

**Files:**
- Create: `docs/insights/agent-ai-sdk-v7-native-types.md`
- Modify: `docs/superpowers/specs/2026-07-17-ai-sdk-v7-native-types-refactor-design.md`（追加偏差记录）

- [ ] **Step 1: 全仓构建与测试**

Run: `cd /Users/taosikai/www/js/vico && pnpm build && pnpm -r test`
Expected: 全部通过（vico/web 无需代码改动，DefaultChatTransport 协议不变）

- [ ] **Step 2: 冒烟测试**

Run: `pnpm dev`，浏览器走通一轮对话：文本回复 → 触发一次工具调用 → 触发一次 on-request 工具审批（暂停/恢复）→ 刷新页面查看历史消息正常显示。
Expected: 全流程正常，SSE 事件被 assistant-ui 正确渲染。开发库如有旧数据，先删除 SQLite 文件重建（直切无兼容）。

- [ ] **Step 3: spec 追加"实施偏差"一节**

将本计划开头"与 spec 的已确认偏差"4 条追加到 spec 文档末尾，标注日期。

- [ ] **Step 4: 写 docs/insights 文档**

`docs/insights/agent-ai-sdk-v7-native-types.md`：记录（1）model 层 ai/internal 积木用法与锁版本原因；(2) TurnOutput=V4 流、turn-stream=UI 映射的分层约定；(3) 持久化 content JSON 约定与 message-utils 入口；(4) reasoning 参数链路。300-500 字即可。

- [ ] **Step 5: Commit**

```bash
git add docs
git commit -m "docs: AI SDK v7 重构实施偏差记录与 insights 沉淀"
```

---

## Self-Review 结果

- **Spec 覆盖**：依赖对齐(T1)、V4 迁移(T2/T6/T9)、model 层 ai/internal(T4)、消息形态(T3/T5/T6)、reasoning(T4/T7)、turn-stream/sse(T8)、导出面(T9)、adapter(T10/T11)、server(T12)、无关错误修复(T2)、测试(各 Task)、验收(T13)——全部有对应 Task；web 侧零改动（偏差 4 已记录）。
- **类型一致性**：`buildToolResultMessage(result: ToolResult, content: string)`、`toModelMessages(entries: Message[])`、`fromModelMessage(msg)`、`turnOutputToSSEResponse` 非 async——各 Task 引用处已核对一致。
- **无占位符**：所有代码步骤含完整代码；测试文件迁移（T9 Step 3）给出精确替换规则与完整 mock 代码。
