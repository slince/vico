# @vico/model

模型接入层：语言模型工厂、ModelClient、消息工具。

统一 Anthropic / OpenAI 等 provider，为上层提供 `createLanguageModel` 工厂与 `ModelClient` 抽象；消息类型 re-export AI SDK 原生类型。

## 主要导出

- `createLanguageModel` — 按 `ModelConfig` 创建语言模型
- `ModelClient` — 模型客户端抽象（流式调用）
- 类型 — `ModelConfig` / `ModelRef` / `ModelRequest` / `ModelStreamResult` / `ReasoningEffort`，`isLanguageModelV4`
- 消息工具 — `getMessageText` / `pickPrimaryUserMessage` / `completedCallIds` / `ensureToolCallConsistency` / `buildAssistantMessage` / `buildToolResultMessage` / `extractApprovalResponses` / `toToolSet` / `ContentPart`
- AI SDK re-export — `ModelMessage` / `UIMessage` / `UIMessageChunk` / `ToolSet`，`convertToModelMessages` / `validateUIMessages`

## 依赖

| 依赖 | 用途 |
|------|------|
| `@vico/types` | 基础数据契约 |
| `@vico/tool`（type） | Tool / ToolCall / ToolResult 类型 |
| `ai` + `@ai-sdk/*` | AI SDK 与 provider |

## 相关文档

- [模型设置说明](../../docs/insights/model-settings-advanced-options.md)
- [@vico/core 拆分方案](../core/SPLIT-PLAN.md)
