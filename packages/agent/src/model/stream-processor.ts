// @vico/agent - 将 ReadableStream<LanguageModelV3StreamPart> 转换为 AsyncGenerator<ModelStreamChunk>
import type { LanguageModelV3StreamPart } from '@ai-sdk/provider';
import type { ModelStreamChunk } from './types.js';

/**
 * 将 provider 原始流转换为类型化的 ModelStreamChunk 异步生成器。
 * 仅 tool-call 需要转换（input 从 JSON 字符串解析），其余透传。
 */
export async function* processStreamParts(
  stream: ReadableStream<LanguageModelV3StreamPart>,
): AsyncGenerator<ModelStreamChunk> {
  const reader = stream.getReader();
  const toolInputBuffers = new Map<string, string>();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      switch (value.type) {
        case 'tool-input-start':
          toolInputBuffers.set(value.id, '');
          yield value;
          break;

        case 'tool-input-delta':
          if (toolInputBuffers.has(value.id)) {
            toolInputBuffers.set(value.id, toolInputBuffers.get(value.id)! + value.delta);
          }
          yield value;
          break;

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

          yield { ...value, input };
          break;
        }

        default:
          yield value as ModelStreamChunk;
      }
    }
  } finally {
    reader.releaseLock();
  }
}
