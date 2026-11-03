// vico/server - Chunk → UIMessage 流（过渡适配器）。
//
// Task 1 后引擎只产出 Chunk；前端在 Task 2 迁移到 ag-ui 前仍消费 ai 的 UIMessage SSE。
// 本适配器把 Chunk 逆映射回 TextStreamPart，再复用 ai 的 toUIMessageStream。
// Task 2 落地后此文件将被 Chunk → ag-ui 事件转换取代。
import {DefaultGeneratedFile, toUIMessageStream, type TextStreamPart, type ToolSet} from 'ai';
import type {Chunk} from '@vico/stream';

/** 把引擎层 Chunk 逆映射回 TextStreamPart（供 toUIMessageStream 消费） */
function chunkToTextStreamPart(chunk: Chunk): TextStreamPart<ToolSet> {
  switch (chunk.type) {
    case 'start':
      return { type: 'start' };
    case 'text-start':
      return { type: 'text-start', id: chunk.payload.id, ...(chunk.payload.providerMetadata != null ? { providerMetadata: chunk.payload.providerMetadata } : {}) };
    case 'text-delta':
      return { type: 'text-delta', id: chunk.payload.id, text: chunk.payload.text, ...(chunk.payload.providerMetadata != null ? { providerMetadata: chunk.payload.providerMetadata } : {}) };
    case 'text-end':
      return { type: 'text-end', id: chunk.payload.id, ...(chunk.payload.providerMetadata != null ? { providerMetadata: chunk.payload.providerMetadata } : {}) };
    case 'reasoning-start':
      return { type: 'reasoning-start', id: chunk.payload.id, ...(chunk.payload.providerMetadata != null ? { providerMetadata: chunk.payload.providerMetadata } : {}) };
    case 'reasoning-delta':
      return { type: 'reasoning-delta', id: chunk.payload.id, text: chunk.payload.text, ...(chunk.payload.providerMetadata != null ? { providerMetadata: chunk.payload.providerMetadata } : {}) };
    case 'reasoning-end':
      return { type: 'reasoning-end', id: chunk.payload.id, ...(chunk.payload.providerMetadata != null ? { providerMetadata: chunk.payload.providerMetadata } : {}) };
    case 'tool-input-start':
      return { type: 'tool-input-start', id: chunk.payload.toolCallId, toolName: chunk.payload.toolName, ...(chunk.payload.providerExecuted != null ? { providerExecuted: chunk.payload.providerExecuted } : {}), ...(chunk.payload.providerMetadata != null ? { providerMetadata: chunk.payload.providerMetadata } : {}) };
    case 'tool-input-delta':
      return { type: 'tool-input-delta', id: chunk.payload.toolCallId, delta: chunk.payload.delta };
    case 'tool-input-end':
      return { type: 'tool-input-end', id: chunk.payload.toolCallId };
    case 'tool-call':
      return { type: 'tool-call', toolCallId: chunk.payload.toolCallId, toolName: chunk.payload.toolName, input: chunk.payload.input, dynamic: false, ...(chunk.payload.providerExecuted != null ? { providerExecuted: chunk.payload.providerExecuted } : {}), ...(chunk.payload.invalid != null ? { invalid: chunk.payload.invalid } : {}), ...(chunk.payload.error != null ? { error: chunk.payload.error } : {}) } as TextStreamPart<ToolSet>;
    case 'tool-result':
      return { type: 'tool-result', toolCallId: chunk.payload.toolCallId, toolName: chunk.payload.toolName, input: chunk.payload.input, output: chunk.payload.output, dynamic: false, ...(chunk.payload.providerExecuted != null ? { providerExecuted: chunk.payload.providerExecuted } : {}), ...(chunk.payload.preliminary != null ? { preliminary: chunk.payload.preliminary } : {}), ...(chunk.payload.providerMetadata != null ? { providerMetadata: chunk.payload.providerMetadata } : {}) };
    case 'tool-error':
      return { type: 'tool-error', toolCallId: chunk.payload.toolCallId, toolName: chunk.payload.toolName, input: chunk.payload.input, error: chunk.payload.error, dynamic: false, ...(chunk.payload.providerExecuted != null ? { providerExecuted: chunk.payload.providerExecuted } : {}), ...(chunk.payload.providerMetadata != null ? { providerMetadata: chunk.payload.providerMetadata } : {}) };
    case 'tool-output-denied':
      return { type: 'tool-output-denied', toolCallId: chunk.payload.toolCallId, toolName: chunk.payload.toolName };
    case 'tool-approval-request':
      return { type: 'tool-approval-request', approvalId: chunk.payload.approvalId, toolCall: { type: 'tool-call', toolCallId: chunk.payload.toolCall.toolCallId, toolName: chunk.payload.toolCall.toolName, input: chunk.payload.toolCall.input, dynamic: false } };
    case 'tool-approval-response':
      return { type: 'tool-approval-response', approvalId: chunk.payload.approvalId, toolCall: { type: 'tool-call', toolCallId: chunk.payload.toolCall.toolCallId, toolName: chunk.payload.toolCall.toolName, input: chunk.payload.toolCall.input, dynamic: false }, approved: chunk.payload.approved, ...(chunk.payload.reason != null ? { reason: chunk.payload.reason } : {}) };
    case 'file':
    case 'reasoning-file':
      return { type: chunk.type, file: new DefaultGeneratedFile({ data: chunk.payload.data, mediaType: chunk.payload.mediaType }), ...(chunk.payload.providerMetadata != null ? { providerMetadata: chunk.payload.providerMetadata } : {}) };
    case 'source':
      return { type: 'source', ...chunk.payload } as unknown as TextStreamPart<ToolSet>;
    case 'custom':
      return { type: 'custom', kind: chunk.payload.kind, ...(chunk.payload.providerMetadata != null ? { providerMetadata: chunk.payload.providerMetadata } : {}) } as TextStreamPart<ToolSet>;
    case 'raw':
      return { type: 'raw', rawValue: chunk.payload.raw };
    case 'start-step':
      return { type: 'start-step', request: { messages: chunk.payload.request.messages }, warnings: chunk.payload.warnings };
    case 'finish-step':
      // toUIMessageStream 对 finish-step 仅取 type（信号级），其余字段无需重建
      return { type: 'finish-step' } as unknown as TextStreamPart<ToolSet>;
    case 'finish':
      return { type: 'finish', finishReason: chunk.payload.finishReason, rawFinishReason: chunk.payload.rawFinishReason, totalUsage: { inputTokens: chunk.payload.totalUsage.inputTokens, outputTokens: chunk.payload.totalUsage.outputTokens, totalTokens: chunk.payload.totalUsage.totalTokens }, usage: chunk.payload.usage } as unknown as TextStreamPart<ToolSet>;
    case 'error':
      return { type: 'error', error: chunk.payload.error };
    case 'abort':
      return { type: 'abort' };
    default:
      throw new Error(`Unknown chunk type: ${(chunk as { type: string }).type}`);
  }
}

/** Chunk → UIMessageStream（复用 ai toUIMessageStream 的 UI 语义） */
export function chunkToUIMessageStream(opts: {
  stream: ReadableStream<Chunk>;
  onError?: (err: unknown) => string;
  messageMetadata?: (opts: { part: TextStreamPart<ToolSet> }) => Record<string, unknown> | undefined;
}): ReturnType<typeof toUIMessageStream> {
  const textStream = opts.stream.pipeThrough(new TransformStream<Chunk, TextStreamPart<ToolSet>>({
    transform(chunk, controller) {
      controller.enqueue(chunkToTextStreamPart(chunk));
    },
  }));

  return toUIMessageStream({
    stream: textStream,
    onError: opts.onError,
    messageMetadata: opts.messageMetadata,
  });
}
