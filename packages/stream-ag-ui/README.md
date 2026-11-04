# @vico/stream-ag-ui

引擎 Chunk ↔ [AG-UI 协议](https://docs.ag-ui.com/) 、ag-ui ↔ ModelMessage 的边界转换层。

## 定位

介于 `@vico/stream`（引擎层 `ChunkType` 协议）与前端（`@assistant-ui/react-ag-ui` 消费的 ag-ui 事件/消息）之间，把引擎输出编码为 ag-ui 协议，并把前端 ag-ui 输入还原为引擎入参 `ModelMessage[]`。服务端路由层不再持有任何 ag-ui 转换逻辑。

## 导出

| 模块 | 函数 | 方向 |
|------|------|------|
| `chunk-to-agui` | `chunkToAgUiStream` / `toTokenUsage` | `ChunkType` 流 → ag-ui `Event` 流 |
| `model-messages` | `aguiMessagesToModelMessages` / `resumeToModelMessages` | ag-ui `Message` / `resume` → `ModelMessage[]` |
| `agui-messages` | `toAgUiMessages` | `Message`（`ModelMessage.content`）→ ag-ui `Message[]`（历史展示） |
| `sse` | `aguiSSEResponse` | ag-ui `Event` 流 → `text/event-stream` `Response` |

## 数据流

```
引擎 LoopAgent → ChunkType 流 (@vico/stream)
    │ chunkToAgUiStream
    ▼
ag-ui Event 流 → aguiSSEResponse → SSE → 前端 @assistant-ui/react-ag-ui

前端 RunAgentInput ── messages/resume
    │ aguiMessagesToModelMessages / resumeToModelMessages
    ▼
ModelMessage[] → Agent.stream()
```

## 依赖

- `@ag-ui/core`（ag-ui 事件与消息类型）
- `@ai-sdk/provider-utils`（`ModelMessage`）
- `@vico/stream`（`ChunkType`）、`@vico/thread`（`Message`）、`@vico/types`（`UsageMetrics` / `SESSION_SCOPE_REASON`）
