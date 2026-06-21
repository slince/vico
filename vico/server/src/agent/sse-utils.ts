/**
 * SSE 流工厂 — 不再依赖 Mastra stream 类型。
 *
 * 导出重新封装 turnEventsToSSE 以保持现有调用方兼容。
 */
export { turnEventsToSSE as createSSEStream } from './vico-stream-utils.js';

/**
 * createNetworkSSEStream 已移除（不再使用 MastraAgentNetworkStream）。
 * Team 聊天功能暂不可用。
 */
export function createNetworkSSEStream(): ReadableStream {
  throw new Error('createNetworkSSEStream removed — team chat is not available');
}
