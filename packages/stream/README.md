# @vico/stream

流式解析、用量计量与 turn 事件。

把模型流解析为结构化 chunk，构造标准 stream part（工具调用/审批/步骤等），并提供 usage 累加工具。

## 主要导出

- `ModelStreamReader` — 模型流读取器
- stream parts 构造器 — `createToolCall` / `toolResultPart` / `v4ToolResultPart` / `toolOutputDeniedPart` / `toolApprovalRequestPart` / `toolApprovalResponsePart` / `v4FilePart` / `startStepPart` / `finishStepPart` / `finishPart`
- usage 工具 — `emptyUsage` / `addTokenCount` / `addUsage` / `fromV4Usage`
- 类型 — `CallModelResult` / `TurnEvent` / `UserMessage`

## 依赖

| 依赖 | 用途 |
|------|------|
| `@vico/types` | 基础数据契约 |
| `@vico/model`（type） | ModelRequest 等 |
| `@vico/tool`（type） | ToolCall / ToolResult |
| `ai` / `@ai-sdk/provider` | AI SDK 流类型 |

## 相关文档

- [AI SDK 流式 chunk 协议](../../docs/insights/ai-sdk-stream-chunk-protocols.md)
- [@vico/core 拆分方案](../core/SPLIT-PLAN.md)
