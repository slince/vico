# @vico/thread

线程/会话存储与消息转换。

定义 `ThreadStore` 端口与 Thread / Turn / Message 等会话数据模型，提供内存实现与 AI SDK 消息互转工具。

## 主要导出

- 类型 — `ThreadStore` / `Thread` / `Turn` / `Message` / `TurnSession` / `TurnStep` / `ThreadMetadata` / `TurnMetadata` / `ThreadContext` / `MessageMetadata` / `SessionApprovedTool` / `TurnStatus` / `MessageWithUsage`
- `InMemoryThreadStore` — 内存版 ThreadStore
- 消息转换 — `toModelMessages` / `fromModelMessage` / `toUiMessages`

## 依赖

| 依赖 | 用途 |
|------|------|
| `@vico/types` | UsageMetrics 等基础契约 |
| `ai` / `@ai-sdk/provider-utils` | 消息类型与工具 |

## 相关文档

- [thread token 用量](../../docs/insights/thread-token-usage.md)
- [@vico/core 拆分方案](../core/SPLIT-PLAN.md)
