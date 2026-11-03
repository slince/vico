# Vico 引擎 Chunk 协议（替代 ai TextStreamPart）

> 任务一产出：引擎层（`@vico/*`）彻底移除 `ai` 包，以自有 `Chunk` 协议作为对外唯一输出契约；`ModelMessage` 及 provider 层类型改从 `@ai-sdk/provider(-utils)` 引入。

## 一、信封格式

借鉴 mastra 的 `ChunkType`（`packages/core/src/stream/types.ts`），固定为三字段：

```ts
{ type: string; runId: string; payload: {...} }
```

- `type`：字面量判别字段；
- `runId`：本次 `stream()` 调用的 run 标识（每次暂停恢复产生新 runId），供多 run / 恢复场景关联；
- `payload`：与 `type` 强绑定，各 type 有独立 payload 接口（定义见 [`packages/stream/src/types.ts`](../../packages/stream/src/types.ts)）。

`stampRunId(runId, draft)` 把 `{ type, payload }` 草稿盖章成完整 `Chunk`；part 构造器返回 `ChunkDraft = Omit<Chunk, 'runId'>`。

## 二、Chunk 类型清单（平替 TextStreamPart）

| type | payload 要点 |
|---|---|
| `start` / `abort` | 空负载（生命周期信号） |
| `text-start` / `text-delta` / `text-end` | `id` / `text` / `providerMetadata?` |
| `reasoning-start` / `reasoning-delta` / `reasoning-end` | 同上 |
| `tool-input-start` / `tool-input-delta` / `tool-input-end` | `toolCallId` / `toolName` / `delta` |
| `tool-call` | `toolCallId` / `toolName` / `input` / `providerExecuted?` / `invalid?` / `error?` |
| `tool-result` | `toolCallId` / `toolName` / `input?` / `output` |
| `tool-error` | 同上，`error: string` |
| `tool-output-denied` | `toolCallId` / `toolName` |
| `tool-approval-request` / `tool-approval-response` | `approvalId` + 内嵌 `toolCall` |
| `file` / `reasoning-file` | `data`（base64/URL）/ `mediaType` |
| `source` / `custom` / `raw` | 来源 / provider 自定义 / 原始事件（JSON 安全子集） |
| `start-step` / `finish-step` | `request.messages` + `warnings`；`response` + `usage` + `performance` + `finishReason` |
| `finish` | `finishReason` + `totalUsage` + 完整 `usage: UsageMetrics` |
| `error` | `error: string` |

## 三、ai 包移除点

- `TextStreamPart` / `UIMessage` / `UIMessageChunk` / `TypedToolCall` / `CallWarning` / `FinishReason` / `StepResultPerformance` / `LanguageModelUsage` / `DefaultGeneratedFile` / `convertToModelMessages` / `validateUIMessages` / `toUIMessageStream` / `createUIMessageStreamResponse` 等 ai 包类型/函数 → 自有 `Chunk` + `@ai-sdk/provider(-utils)` 引入。
- `ai/internal` 的 `standardizePrompt` / `convertToLanguageModelPrompt` / `prepareTools` → 本地重实现于 [`packages/model/src/prompt-conversion.ts`](../../packages/model/src/prompt-conversion.ts)（Vico 子集：文本/推理/工具调用/工具结果/审批标记；连续 tool 消息合并、空 tool 消息剔除、`tool-approval-request` 剥离、非 providerExecuted `tool-approval-response` 剥离）。
- `ModelMessage` / `ToolSet` / `ToolCallPart` / `ToolResultPart` / `ToolApprovalRequest/Response` / `tool` / `asSchema` 等 → `@ai-sdk/provider-utils`；`LanguageModelV4*` / `SharedV4*` / `JSONValue` → `@ai-sdk/provider`。

## 四、分层（过渡态）

```
ModelClient.stream()      → LanguageModelV4StreamPart   (@ai-sdk/provider，保留)
  └ createModelStreamTransformer(runId, request)
TurnOutput.stream         → Chunk                       (引擎合同，本协议)
  └ vico/server chunk-to-uimessage.ts（过渡）→ TextStreamPart → toUIMessageStream → UIMessageChunk
  └ vico/server chunk-to-agui.ts（目标态，见 ag-ui 迁移方案）→ ag-ui 事件
```

## 五、包依赖变化

移除 `ai` 依赖、新增 `@ai-sdk/provider(-utils)`（catalog 版本）的引擎包：`@vico/stream`、`@vico/agent`、`@vico/model`、`@vico/thread`、`@vico/compaction`、`@vico/context`。`@vico/thread` 的 `toUiMessages`（UIMessage 展示转换）上移到 `vico/server/src/services/thread/ui-messages.ts`（UI 层关注点）。
