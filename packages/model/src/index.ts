// @vico/model - 模型接入（工厂、客户端、消息工具）

export { createLanguageModel } from './factory.js';
export { ModelClient } from './model-client.js';
export { BufferedModelStream } from './buffered-model-stream.js';
export { isLanguageModel, type CallModelResult, type LanguageModel, type ModelConfig, type ModelRef, type ModelRequest, type ModelStreamPart, type ModelStreamResult, type ModelToolCall, type ReasoningEffort } from './types.js';
export { emptyUsage, fromV4Usage } from './usage.js';
export {
  getMessageText,
  pickPrimaryUserMessage,
  completedCallIds,
  ensureToolCallConsistency,
  buildAssistantMessage,
  buildToolResultMessage,
  extractApprovalResponses,
  toToolSet,
  type ContentPart,
} from './message-utils.js';
export type { ModelMessage, UIMessage, UIMessageChunk, ToolSet } from 'ai';
export { convertToModelMessages, validateUIMessages } from 'ai';
