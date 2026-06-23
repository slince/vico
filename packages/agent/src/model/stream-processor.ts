// @vico/agent - Convert ReadableStream<LanguageModelV3StreamPart> to AsyncGenerator<ModelStreamChunk>
import type { LanguageModelV3StreamPart } from '@ai-sdk/provider';
import type { ModelStreamChunk } from './types.js';

/**
 * Process raw provider stream parts into our typed ModelStreamChunk generator.
 * Every LanguageModelV3StreamPart variant is mapped. Tool call input is parsed
 * from string to unknown, with buffered delta fallback.
 */
export async function* processStreamParts(
  stream: ReadableStream<LanguageModelV3StreamPart>,
): AsyncGenerator<ModelStreamChunk> {
  const reader = stream.getReader();

  // Buffer incremental tool input deltas keyed by tool call id
  const toolInputBuffers = new Map<string, string>();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      switch (value.type) {
        // ── Text lifecycle ──
        case 'text-start':
          yield { type: 'text-start', id: value.id, providerMetadata: value.providerMetadata };
          break;
        case 'text-delta':
          yield { type: 'text-delta', id: value.id, delta: value.delta, providerMetadata: value.providerMetadata };
          break;
        case 'text-end':
          yield { type: 'text-end', id: value.id, providerMetadata: value.providerMetadata };
          break;

        // ── Reasoning lifecycle ──
        case 'reasoning-start':
          yield { type: 'reasoning-start', id: value.id, providerMetadata: value.providerMetadata };
          break;
        case 'reasoning-delta':
          yield { type: 'reasoning-delta', id: value.id, delta: value.delta, providerMetadata: value.providerMetadata };
          break;
        case 'reasoning-end':
          yield { type: 'reasoning-end', id: value.id, providerMetadata: value.providerMetadata };
          break;

        // ── Tool input lifecycle ──
        case 'tool-input-start':
          toolInputBuffers.set(value.id, '');
          yield {
            type: 'tool-input-start',
            id: value.id,
            toolName: value.toolName,
            providerExecuted: value.providerExecuted,
            dynamic: value.dynamic,
            title: value.title,
            providerMetadata: value.providerMetadata,
          };
          break;
        case 'tool-input-delta':
          if (toolInputBuffers.has(value.id)) {
            toolInputBuffers.set(value.id, toolInputBuffers.get(value.id)! + value.delta);
          }
          yield { type: 'tool-input-delta', id: value.id, delta: value.delta, providerMetadata: value.providerMetadata };
          break;
        case 'tool-input-end':
          yield { type: 'tool-input-end', id: value.id, providerMetadata: value.providerMetadata };
          break;

        // ── Tool call (parse input) ──
        case 'tool-call': {
          const buffered = toolInputBuffers.get(value.toolCallId);
          toolInputBuffers.delete(value.toolCallId);

          let input: unknown;
          try {
            input = typeof value.input === 'string' ? JSON.parse(value.input) : value.input;
          } catch {
            if (buffered) {
              try { input = JSON.parse(buffered); } catch { input = buffered; }
            } else {
              input = value.input;
            }
          }

          yield {
            type: 'tool-call',
            toolCallId: value.toolCallId,
            toolName: value.toolName,
            input,
            providerExecuted: value.providerExecuted,
            dynamic: value.dynamic,
            providerMetadata: value.providerMetadata,
          };
          break;
        }

        // ── Tool result (provider-executed) ──
        case 'tool-result':
          yield {
            type: 'tool-result',
            toolCallId: value.toolCallId,
            toolName: value.toolName,
            result: value.result,
            isError: value.isError,
            preliminary: value.preliminary,
            dynamic: value.dynamic,
            providerMetadata: value.providerMetadata,
          };
          break;

        // ── Tool approval request ──
        case 'tool-approval-request':
          yield {
            type: 'tool-approval-request',
            approvalId: value.approvalId,
            toolCallId: value.toolCallId,
            providerMetadata: value.providerMetadata,
          };
          break;

        // ── File ──
        case 'file':
          yield {
            type: 'file',
            mediaType: value.mediaType,
            data: value.data,
            providerMetadata: value.providerMetadata,
          };
          break;

        // ── Source ──
        case 'source':
          if (value.sourceType === 'url') {
            yield {
              type: 'source',
              sourceType: 'url',
              id: value.id,
              url: value.url,
              title: value.title,
              providerMetadata: value.providerMetadata,
            };
          } else {
            yield {
              type: 'source',
              sourceType: 'document',
              id: value.id,
              mediaType: value.mediaType,
              title: value.title,
              filename: value.filename,
              providerMetadata: value.providerMetadata,
            };
          }
          break;

        // ── Metadata ──
        case 'stream-start':
          yield { type: 'stream-start', warnings: value.warnings };
          break;
        case 'response-metadata':
          yield {
            type: 'response-metadata',
            id: value.id,
            timestamp: value.timestamp,
            modelId: value.modelId,
          };
          break;

        // ── Finish ──
        case 'finish':
          yield {
            type: 'finish',
            finishReason: value.finishReason.unified,
            rawFinishReason: value.finishReason.raw,
            usage: {
              inputTokens: value.usage.inputTokens?.total ?? 0,
              outputTokens: value.usage.outputTokens?.total ?? 0,
            },
            providerMetadata: value.providerMetadata,
          };
          break;

        // ── Raw ──
        case 'raw':
          yield { type: 'raw', rawValue: value.rawValue };
          break;

        // ── Error ──
        case 'error':
          yield {
            type: 'error',
            message: value.error instanceof Error ? value.error.message : String(value.error),
          };
          break;
      }
    }
  } finally {
    reader.releaseLock();
  }
}
