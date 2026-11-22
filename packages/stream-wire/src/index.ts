/**
 * `@vico/stream-wire`
 *
 * vico 前后端线上协议的编解码：请求信封类型、消息/审批决议转换、ChunkType → SSE。
 */
export {chunkSSEResponse, toWireChunk} from './chunk-sse.js';
export {resumeToModelMessages, vicoMessagesToModelMessages} from './messages.js';
export type {VicoApprovalResume, VicoRunConfig, VicoRunRequest} from './types.js';
