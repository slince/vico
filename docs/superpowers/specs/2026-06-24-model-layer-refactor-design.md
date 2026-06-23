# Model Layer Refactor: `streamText` → `@ai-sdk/provider` `doStream()`

**日期**: 2026-06-24  
**状态**: 待实现  
**目标**: 将 Agent loop 中调用模型的部分从 `ai` 包的 `streamText` 替换为 `@ai-sdk/provider` 底层的 `doStream()`，创建一个完整的薄封装层，获得对 prompt、tool、stream 的完全可见性和控制权。

## 动机

Vercel AI SDK 的 `ai` 包 `streamText` 是高层封装，内部黑盒处理 prompt 标准化、消息格式转换、工具格式转换、流式 chunk 解析、middleware 等。对于项目而言，这些问题需要解决：

- 发送给模型的 prompt 不可见，大量 `as any` 绕过类型检查
- Token 计数依赖黑盒内部计算，无法精确控制
- 错误处理和重试逻辑隐藏在 `streamText` 内部
- Provider 原生响应信息（如 Anthropic stop_reason、usage 细节）被吞掉
- 隐式依赖 `ai` 包（`@vico/agent` 的 `package.json` 未声明，靠 pnpm hoisting）

## 目标

1. 用 `LanguageModelV3.doStream()` 替换所有 `streamText` 调用
2. 创建一个 `ModelClient` 类和配套转换层，收拢所有模型交互
3. 完整适配 `LanguageModelV3StreamPart` 协议，不丢事件、不吞字段
4. `@vico/agent` 告别对 `ai` 包的依赖，正式依赖 `@ai-sdk/provider`
5. 保持上层 `AgentLoop` 和 `ContextCompactor` 的调用方式尽量不变

---

## 架构

```
AgentLoop / ContextCompactor
     │
     ▼
ModelClient.stream(options)
     │
     ├─ prompt-converter.ts     ModelMessage[] → LanguageModelV3Prompt
     ├─ tool-converter.ts       Tool[] → LanguageModelV3FunctionTool[]
     ├─ model.doStream(prompt, tools, ...)
     └─ stream-processor.ts     ReadableStream<LanguageModelV3StreamPart> → AsyncGenerator<ModelStreamChunk>
```

### 调用链变化

```
之前:
Vico container
  └─ createLanguageModel(ref) → LanguageModel (from 'ai')
       └─ new Agent({ languageModel, ... })
            └─ AgentLoop → streamText({ model: agent.languageModel, messages: as any, tools: as any, ... })
            └─ ContextCompactor → streamText(...)

之后:
Vico container
  └─ createLanguageModel(ref) → LanguageModelV3
       └─ new Agent({ model, ... })
            └─ this.modelClient = new ModelClient(this.model)
            └─ AgentLoop → this.agent.modelClient.stream({ ... })   // 类型安全
            └─ ContextCompactor → this.agent.modelClient.stream({ ... })
```

---

## 新建文件

### 1. `packages/agent/src/model/model-client.ts`

```typescript
import type { LanguageModelV3 } from '@ai-sdk/provider';
import { convertToPrompt } from './prompt-converter.js';
import { convertTools } from './tool-converter.js';
import { processStreamParts } from './stream-processor.js';
import type { ModelCallOptions, ModelStreamResult } from './types.js';

export class ModelClient {
  constructor(private model: LanguageModelV3) {}

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

### 2. `packages/agent/src/model/prompt-converter.ts`

`ModelMessage[]` → `LanguageModelV3Prompt`。逐消息映射：

| ModelMessage role | LanguageModelV3Message |
|---|---|
| `system` | 不做（system 作为 `ModelCallOptions.system` 单独传入） |
| `user` | `{ role: 'user', content: [{ type: 'text', text }] }` |
| `assistant` (文本) | `{ role: 'assistant', content: [{ type: 'text', text }] }` |
| `assistant` (含 toolCalls) | content 追加 `{ type: 'tool-call', toolCallId, toolName, input }` |
| `tool` | `{ role: 'tool', content: [{ type: 'tool-result', toolCallId, toolName, output: { type: 'text', value } }] }` |

### 3. `packages/agent/src/model/tool-converter.ts`

`Vico Tool[]` → `LanguageModelV3FunctionTool[]`：

```typescript
{ type: 'function', name, description, inputSchema }
```

注意：Vico Tool 的 `inputSchema`（zod → JSONSchema）需确保兼容 `JSONSchema7`。必要时加 `zodToJsonSchema()` 辅助。

### 4. `packages/agent/src/model/stream-processor.ts`

将 `ReadableStream<LanguageModelV3StreamPart>` 转为 `AsyncGenerator<ModelStreamChunk>`。

**处理原则**：`LanguageModelV3StreamPart` 的所有变体逐项映射，不丢事件，不吞字段。仅对 `tool-call` 的 `input: string` 做 `JSON.parse`，其余字段原样透传。

**Tool call 处理**：`tool-input-start/delta/end` + 最终 `tool-call`。`tool-call` 自带解析好的 `input`，同时 fallback 到 buffer 中累计的增量 delta。

**finish/usage 处理**：`finishReason` 使用 `unified` 字段，`usage` 提取 `inputTokens.total` 和 `outputTokens.total`。

### 5. `packages/agent/src/model/types.ts` 新增

`ModelStreamChunk` 联合类型 — `LanguageModelV3StreamPart` 所有变体的完整映射：

```
text-start / text-delta / text-end
reasoning-start / reasoning-delta / reasoning-end
tool-input-start / tool-input-delta / tool-input-end
tool-call (input 已解析为 JSON object)
tool-result / tool-approval-request
file / source
stream-start / response-metadata / finish / error / raw
```

`ModelCallOptions`、`ModelStreamResult`、`ModelUsage`。

### 6. `packages/agent/src/stream/sse.ts`

自己实现 SSE 格式化，替换 `ai` 包的 `createUIMessageStreamResponse`：

```typescript
export function createSSEResponse(
  stream: ReadableStream<unknown>,
  headers?: Record<string, string>,
): Response
```

每个 chunk 执行 `JSON.stringify` → `data: {...}\n\n`，设置 `Content-Type: text/event-stream`。

### 7. `packages/agent/src/stream/types.ts`

`UIStreamChunk` 联合类型，替代从 `ai` 包导入的 `UIMessageChunk`。结构完全一致，确保 client 无感知。

---

## 修改文件

### 1. `packages/agent/src/model/factory.ts`

```diff
- import type { LanguageModel } from 'ai';
+ import type { LanguageModelV3 } from '@ai-sdk/provider';

- export function createLanguageModel(ref: ModelRef): LanguageModel {
+ export function createLanguageModel(ref: ModelRef): LanguageModelV3 {
```

`createOpenAI().chat()` 和 `createAnthropic()()` 的返回值本身就是 `LanguageModelV3`，无需转换。

### 2. `packages/agent/src/agent-loop/agent.ts`

```diff
- import type { LanguageModel } from 'ai';
+ import type { LanguageModelV3 } from '@ai-sdk/provider';
+ import { ModelClient } from '../model/model-client.js';

  export class Agent {
-   readonly languageModel: LanguageModel;
+   readonly model: LanguageModelV3;
+   readonly modelClient: ModelClient;

    constructor(params: {
-     languageModel: LanguageModel;
+     model: LanguageModelV3;
    }) {
-     this.languageModel = params.languageModel;
+     this.model = params.model;
+     this.modelClient = new ModelClient(params.model);
    }
```

### 3. `packages/agent/src/agent-loop/agent-loop.ts`

```diff
- import { streamText } from 'ai';
- import { toAISDKTools } from '../tool/utils.js';

  private async *callModel(...) {
-   const result = streamText({
-     model: this.agent.languageModel,
-     system: request.system,
-     messages: request.messages as any,
-     tools: toAISDKTools(request.tools) as any,
-     maxOutputTokens: request.maxTokens,
-     temperature: request.temperature,
-     abortSignal: signal,
-   });
-
-   for await (const chunk of result.fullStream) {
+   const { stream } = await this.agent.modelClient.stream({
+     system: request.system,
+     messages: request.messages,
+     tools: request.tools,
+     maxOutputTokens: request.maxTokens,
+     temperature: request.temperature,
+     abortSignal: signal,
+   });
+
+   for await (const chunk of stream) {
      switch (chunk.type) {
        // 结构基本不变，finish 的 usage 字段路径变化：
        // 之前: chunk.totalUsage.inputTokens
        // 之后: chunk.usage.inputTokens
      }
    }
```

### 4. `packages/agent/src/agent-loop/agent-loop.ts` 中的 `tryCompact()`

```diff
  private async *tryCompact(messages, signal) {
-   const result = await this.compactor.compactIfNeeded(messages, this.agent.languageModel, signal);
+   const result = await this.compactor.compactIfNeeded(messages, this.agent.modelClient, signal);
  }
```

### 5. `packages/agent/src/agent-loop/context-compactor.ts`

```diff
- import { streamText } from 'ai';
- import type { LanguageModel } from 'ai';
+ import type { ModelClient } from '../model/model-client.js';

- async compactIfNeeded(items, languageModel, signal) {
+ async compactIfNeeded(items, modelClient: ModelClient, signal) {

-   const result = streamText({
-     system: 'Summarize the following conversation concisely...',
-     model: languageModel,
-     messages: head as any,
-     abortSignal: signal,
-   });
-   for await (const chunk of result.fullStream) {
+   const { stream } = await modelClient.stream({
+     system: 'Summarize the following conversation concisely...',
+     messages: head,
+     abortSignal: signal,
+   });
+   for await (const chunk of stream) {
```

### 5. `packages/agent/src/stream/turn-stream.ts`

```diff
- import { createUIMessageStreamResponse, type UIMessageChunk } from 'ai';
+ import { createSSEResponse } from './sse.js';
+ import type { UIStreamChunk } from './types.js';

- const stream = new ReadableStream<UIMessageChunk>({
+ const stream = new ReadableStream<UIStreamChunk>({

- const response = createUIMessageStreamResponse({ stream, headers: {...} });
+ const response = createSSEResponse(stream, {...});
```

### 6. `packages/agent/src/tool/utils.ts`

删除 `toAISDKTools` 函数。检查文件是否还有其他导出，如无则删除整文件。

### 7. `packages/agent/package.json`

```diff
  "dependencies": {
    "@ai-sdk/provider": "^3.0.10",
+   "@ai-sdk/openai": "workspace:*",    // 如果尚未直接依赖，需要新增
+   "@ai-sdk/anthropic": "workspace:*",
  }
```

### 8. `packages/agent/src/index.ts`

导出新增类型：`ModelStreamChunk`、`ModelCallOptions`、`ModelStreamResult`、`ModelClient`、`UIStreamChunk`。

### 8. `packages/agent/src/container/vico.ts`

```diff
- import type {LanguageModel} from 'ai';
+ import type {LanguageModelV3} from '@ai-sdk/provider';

- export type LanguageModelFactory = (ref: ModelRef) => LanguageModel;
+ export type LanguageModelFactory = (ref: ModelRef) => LanguageModelV3;

- private async buildAgent(config: AgentConfig, languageModel: LanguageModel): Promise<Agent> {
+ private async buildAgent(config: AgentConfig, model: LanguageModelV3): Promise<Agent> {

    async createAgent(config: AgentConfig): Promise<Agent> {
-     const languageModel = this.languageModelFactory(config.model);
-     const agent = await this.buildAgent(config, languageModel);
+     const model = this.languageModelFactory(config.model);
+     const agent = await this.buildAgent(config, model);
    }

    // Agent 构造函数
    const agent = new Agent({
      config,
-     languageModel,
+     model,
      skills, tools, memory, thread,
    });
```

### 9. `packages/server` 端引用

`vico/server/src/chat/chat.ts` 构建 Agent 时，`languageModel` 参数改名为 `model`。

### 10. 测试文件：`__tests__/agent-loop.test.ts` 和 `agent-runtime.test.ts`

当前 mock：
```typescript
import type { LanguageModel } from 'ai';
const mockLM: LanguageModel = 'mock-model' as unknown as LanguageModel;
```

需要改为 `LanguageModelV3` mock，包含 `doStream` 方法：
```typescript
import type { LanguageModelV3 } from '@ai-sdk/provider';

const mockLM: LanguageModelV3 = {
  specificationVersion: 'v3',
  provider: 'mock',
  modelId: 'mock-model',
  supportedUrls: {},
  doGenerate: async () => { throw new Error('not implemented'); },
  doStream: async () => { /* mock streaming logic */ },
};
```

---

## 类型兼容性注意事项

1. **Zod schema → JSONSchema7**：Vico Tool 的 `inputSchema` 是 zod schema 对象，`LanguageModelV3FunctionTool.inputSchema` 需要 `JSONSchema7`。需要 `zodToJsonSchema()` 转换（zod 4 有 `z.toJSONSchema(schema)` 方法）。

2. **`LanguageModelV3` 获取**：`createOpenAI().chat(modelName)` 和 `createAnthropic()(modelName)` 返回的对象实现了 `LanguageModelV3`。当前 `import type { LanguageModel } from 'ai'` 是联合类型 `LanguageModelV3 | LanguageModelV2 | string`。改为直接 `import type { LanguageModelV3 } from '@ai-sdk/provider'`。

3. **`@ai-sdk/openai` 和 `@ai-sdk/anthropic`**：这两个 provider 包仍然是创建 `LanguageModelV3` 实例的工厂，不会移除。

4. **SSE 协议**：AI SDK UI 的 SSE 协议格式是 `data: <json>\n\n`，client 端（`@assistant-ui/react`）按此格式解析。自己实现的 SSE 格式化保持相同格式即可。

5. **`finish` 事件 usage 结构变化**：`streamText` 返回 `{ totalUsage: { inputTokens, outputTokens } }`，`doStream` 返回 `{ usage: { inputTokens: { total }, outputTokens: { total } } }`。需要在 `agent-loop.ts` 中调整字段访问路径。

---

## 不在范围内的内容

- RAG、Memory、Skill 等其他模块 — 不改动
- `vico/server` 端的 `ModelManager` — 不改动（只改调用 Agent 时的参数名）
- 前端 `vico/web` — 不改动
- `@ai-sdk/openai` / `@ai-sdk/anthropic` provider 包 — 保留作为 `LanguageModelV3` 工厂
