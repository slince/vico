/**
 * AI SDK 协议流 — 不再依赖 @mastra/ai-sdk。
 *
 * 导出重新封装 turnEventsToAISDK 以保持现有调用方兼容。
 */
export { turnEventsToAISDK as createAISDKStream } from './vico-stream-utils.js';

export function createNetworkAISDKStream(): Promise<Response> {
  throw new Error('createNetworkAISDKStream removed — team chat is not available');
}
