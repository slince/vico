// @vico/agent - 将 ReadableStream<LanguageModelV3StreamPart> 转换为 AsyncGenerator<ModelStreamChunk>
import type { LanguageModelV3StreamPart } from '@ai-sdk/provider';
import type { ModelStreamChunk } from './types.js';

/**
 * 将 provider 原始流转换为类型化的 ModelStreamChunk 异步生成器。
 * 完整映射 LanguageModelV3StreamPart 的所有变体。工具调用输入从 JSON 字符串解析，
 * 解析失败时回退到缓冲的增量文本。
 */
export async function* processStreamParts(
  stream: ReadableStream<LanguageModelV3StreamPart>,
): AsyncGenerator<ModelStreamChunk> {
  const reader = stream.getReader();

  // 按 toolCallId 缓冲增量工具输入
  const toolInputBuffers = new Map<string, string>();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      switch (value.type) {
        // ── 文本生命周期 ──
        case 'text-start':
          yield { type: 'text-start', id: value.id, providerMetadata: value.providerMetadata };
          break;
        case 'text-delta':
          yield { type: 'text-delta', id: value.id, delta: value.delta, providerMetadata: value.providerMetadata };
          break;
        case 'text-end':
          yield { type: 'text-end', id: value.id, providerMetadata: value.providerMetadata };
          break;

        // ── 推理生命周期 ──
        case 'reasoning-start':
          yield { type: 'reasoning-start', id: value.id, providerMetadata: value.providerMetadata };
          break;
        case 'reasoning-delta':
          yield { type: 'reasoning-delta', id: value.id, delta: value.delta, providerMetadata: value.providerMetadata };
          break;
        case 'reasoning-end':
          yield { type: 'reasoning-end', id: value.id, providerMetadata: value.providerMetadata };
          break;

        // ── 工具输入生命周期 ──
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

        // ── 工具调用（解析输入） ──
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

        // ── 工具结果（provider 自行执行的工具） ──
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

        // ── 工具审批请求 ──
        case 'tool-approval-request':
          yield {
            type: 'tool-approval-request',
            approvalId: value.approvalId,
            toolCallId: value.toolCallId,
            providerMetadata: value.providerMetadata,
          };
          break;

        // ── 文件 ──
        case 'file':
          yield {
            type: 'file',
            mediaType: value.mediaType,
            data: value.data,
            providerMetadata: value.providerMetadata,
          };
          break;

        // ── 来源 ──
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

        // ── 元数据 ──
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

        // ── 结束 ──
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

        // ── 原始数据 ──
        case 'raw':
          yield { type: 'raw', rawValue: value.rawValue };
          break;

        // ── 错误 ──
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
