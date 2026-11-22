/**
 * `@vico/assistant-ui-runtime`
 *
 * vico 协议（引擎 `ChunkType` 流 + `AgentMessage` 消息）到 assistant-ui 的适配层。
 * 对外只暴露一个运行时入口 `useVicoRuntime`，协议细节（SSE 解析、部件累积、审批续跑）都在包内。
 */
export {createSseTransport, type SseTransportOptions} from './transport/sse-transport.js';
export {createHistoryAdapter, isRemoteThreadId, LOCAL_THREAD_ID_PREFIX} from './history/history-adapter.js';
export {agentMessagesToThreadMessages} from './history/agent-message-to-thread-message.js';
export {ChunkAccumulator, type AccumulatorSnapshot} from './accumulator/chunk-accumulator.js';
export {collectApprovalResumes, markApprovalsSent, type SentApprovalIds} from './approval/resume.js';
export {createVicoChatModelAdapter, type VicoChatModelAdapterOptions} from './runtime/chat-model-adapter.js';
export {useVicoThreadRuntime} from './runtime/use-vico-thread-runtime.js';
export {useVicoRuntime} from './use-vico-runtime.js';
export type {
  VicoApprovalResume,
  VicoRunConfig,
  VicoRunHandle,
  VicoRunRequest,
  VicoRuntime,
  VicoRuntimeOptions,
  VicoTransport,
} from './types.js';
