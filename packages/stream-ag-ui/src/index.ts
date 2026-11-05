// @vico/stream-ag-ui - 引擎 Chunk ↔ ag-ui 协议、ag-ui ↔ ModelMessage 的边界转换层。
//
// 职责边界（介于 @vico/stream 引擎层与 @assistant-ui/react-ag-ui 前端之间）：
// - chunk-to-agui：引擎 ChunkType 流 → ag-ui 事件流（含 UsageMetrics → TokenUsage）
// - agui-to-model-content：ag-ui ContentPart → ModelMessage content part
// - model-to-agui-content：ModelMessage content part → ag-ui ContentPart
// - model-messages：ag-ui 消息 / resume → 引擎 ModelMessage（本轮输入）
// - agui-messages：ThreadStore Message（ModelMessage.content）→ ag-ui Message（历史展示）
// - sse：ag-ui 事件流 → SSE Response（text/event-stream 编码）

export { createChunkToAgUiTransformer, toTokenUsage } from './chunk-to-agui.js';
export { aguiContentToModelContent, aguiContentToText, type ModelUserContentParts } from './agui-to-model-content.js';
export { modelContentToAguiContent } from './model-to-agui-content.js';
export { toAgUiMessages } from './agui-messages.js';
export { aguiMessagesToModelMessages, resumeToModelMessages } from './model-messages.js';
export { aguiSSEResponse } from './sse.js';
