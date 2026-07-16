/**
 * TurnOutput（LanguageModelV4StreamPart 流）→ AI SDK UIMessageChunk SSE 响应。
 * 复用 createUIMessageStream / createUIMessageStreamResponse，供 @assistant-ui/react 原生消费。
 */
import { createUIMessageStream, createUIMessageStreamResponse } from 'ai';
import type { UIMessageChunk } from 'ai';
import { asLanguageModelUsage } from 'ai/internal';
import type { LanguageModelV4Usage } from '@ai-sdk/provider';
import type { TurnOutput } from '../agent-loop/turn-output.js';
import type { TurnResult } from '../agent-loop/agent-loop-options.js';

/** V4 tool-call 的 input 是 JSON 字符串，解析失败时原样透传 */
function safeParseJson(input: unknown): unknown {
  if (typeof input !== 'string') return input ?? {};
  try {
    return JSON.parse(input || '{}');
  } catch {
    return input;
  }
}

/** V4 文件数据（data/url 两种变体）→ 可展示 URL（url 直用，data 转 base64 data URI） */
function toFileUrl(data: { type: 'data'; data: Uint8Array | string } | { type: 'url'; url: URL }, mediaType: string): string {
  if (data.type === 'url') return data.url.href;
  const base64 = typeof data.data === 'string' ? data.data : Buffer.from(data.data).toString('base64');
  return `data:${mediaType};base64,${base64}`;
}

/**
 * TurnOutput → SSE Response（AI SDK UI Message Stream 协议）。
 *
 * @param output - TurnOutput 实例，包含 V4 流和结果 Promise
 * @param options - 可选配置，onFinish 可在 finish chunk 发出前修改 messageMetadata
 * @returns SSE 格式的 Response 对象
 */
export function turnOutputToSSEResponse(
  output: TurnOutput,
  options?: { onFinish?: (finish: Extract<UIMessageChunk, { type: 'finish' }>, fullText: string) => void | Promise<void> },
): Response {
  const stream = createUIMessageStream({
    execute: async ({ writer }) => {
      let fullText = '';
      /** 从 model finish part 中捕获的 token 用量 */
      let modelUsage: LanguageModelV4Usage | undefined;
      let inStep = false;

      writer.write({ type: 'start' });

      const reader = output.stream.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          switch (value.type) {
            // ── 透传：V4 part 与 UIMessageChunk 同名同形 ──
            case 'text-start':
              if (!inStep) { writer.write({ type: 'start-step' }); inStep = true; }
              writer.write(value);
              break;

            case 'text-delta':
              fullText += value.delta;
              writer.write(value);
              break;

            case 'text-end':
            case 'reasoning-start':
            case 'reasoning-delta':
            case 'reasoning-end':
            case 'custom':
              writer.write(value);
              break;

            // ── 字段映射 ──
            case 'tool-input-start':
              writer.write({ type: 'tool-input-start', toolCallId: value.id, toolName: value.toolName });
              break;

            case 'tool-input-delta':
              writer.write({ type: 'tool-input-delta', toolCallId: value.id, inputTextDelta: value.delta });
              break;

            case 'tool-input-end':
              break;

            case 'tool-call':
              writer.write({ type: 'tool-input-available', toolCallId: value.toolCallId, toolName: value.toolName, input: safeParseJson(value.input) });
              break;

            case 'tool-result':
              if (value.isError) {
                writer.write({ type: 'tool-output-error', toolCallId: value.toolCallId, errorText: String(value.result) });
              } else {
                writer.write({ type: 'tool-output-available', toolCallId: value.toolCallId, output: value.result });
              }
              break;

            case 'tool-approval-request':
              writer.write({ type: 'tool-approval-request', approvalId: value.approvalId, toolCallId: value.toolCallId });
              break;

            case 'source':
              if (value.sourceType === 'url') {
                writer.write({ type: 'source-url', sourceId: value.id, url: value.url, title: value.title, providerMetadata: value.providerMetadata });
              } else {
                writer.write({ type: 'source-document', sourceId: value.id, mediaType: value.mediaType, title: value.title, filename: value.filename, providerMetadata: value.providerMetadata });
              }
              break;

            case 'file':
              writer.write({ type: 'file', url: toFileUrl(value.data, value.mediaType), mediaType: value.mediaType, providerMetadata: value.providerMetadata });
              break;

            case 'reasoning-file':
              writer.write({ type: 'reasoning-file', url: toFileUrl(value.data, value.mediaType), mediaType: value.mediaType, providerMetadata: value.providerMetadata });
              break;

            case 'response-metadata':
              writer.write({ type: 'message-metadata', messageMetadata: { modelId: value.modelId, timestamp: value.timestamp } });
              break;

            case 'finish':
              modelUsage = value.usage;
              break;

            case 'error':
              writer.write({ type: 'error', errorText: value.error instanceof Error ? value.error.message : String(value.error) });
              break;

            default:
              // stream-start / raw：内部使用，不透出
              break;
          }
        }
      } finally {
        reader.releaseLock();
      }

      const result: TurnResult = await output.result;

      if (result.status === 'aborted') {
        writer.write({ type: 'abort' });
      }
      if (result.status === 'paused') {
        // Vico 自定义事件走原生 data-* 通道
        writer.write({ type: 'data-turn-paused', data: { reason: 'tool-approval', turnId: result.turn.id }, transient: true } as UIMessageChunk);
      }
      if (inStep) {
        writer.write({ type: 'finish-step' });
      }

      const finish: Extract<UIMessageChunk, { type: 'finish' }> = {
        type: 'finish',
        finishReason: result.status === 'completed' || result.status === 'paused' ? 'stop' : 'error',
        // usage 用 ai/internal 的 asLanguageModelUsage 扁平化
        messageMetadata: modelUsage ? { custom: { usage: asLanguageModelUsage(modelUsage) } } : undefined,
      };
      await options?.onFinish?.(finish, fullText);
      writer.write(finish);
    },
    onError: (e) => (e instanceof Error ? e.message : String(e)),
  });

  return createUIMessageStreamResponse({ stream });
}
