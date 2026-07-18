/**
 * TurnOutput（AgentStreamPart / TextStreamPart 流）→ AI SDK UIMessageChunk SSE 响应。
 * 复用 createUIMessageStream / createUIMessageStreamResponse，供 @assistant-ui/react 原生消费。
 *
 * 引擎已合成 start-step / finish-step / finish / abort 生命周期 part，
 * 本层只做协议字段映射（TextStreamPart 的 text ↔ UIMessageChunk 的 delta 等），不再推断状态。
 */
import { createUIMessageStream, createUIMessageStreamResponse } from 'ai';
import type { LanguageModelUsage, UIMessageChunk } from 'ai';
import { addLanguageModelUsage } from 'ai/internal';
import type { TurnOutput } from '../agent-loop/turn-output.js';
import type { TurnResult } from '../agent-loop/agent-loop-options.js';

/**
 * GeneratedFile → 可展示 URL。
 * URL 变体在引擎侧（v4FilePart）以原始 URL 串存入 base64 字段，按前缀识别直接透出；
 * 其余为 base64 数据，转 data URI。
 */
function toFileUrl(file: { base64: string; mediaType: string }): string {
  return /^https?:\/\//.test(file.base64) ? file.base64 : `data:${file.mediaType};base64,${file.base64}`;
}

/**
 * TurnOutput → SSE Response（AI SDK UI Message Stream 协议）。
 *
 * @param output - TurnOutput 实例，包含引擎层 TextStreamPart 流和结果 Promise
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
      /** 跨 step 累加的 token 用量（来自各 finish-step part） */
      let totalUsage: LanguageModelUsage | undefined;

      writer.write({ type: 'start' });

      const reader = output.stream.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          switch (value.type) {
            // ── 引擎生命周期 ──
            case 'start':
              // writer 已写入自身 start，跳过引擎 start 避免重复
              break;

            case 'start-step':
              writer.write({ type: 'start-step' });
              break;

            case 'finish-step':
              // 模型响应元数据以 message-metadata 透出（保留原 response-metadata 行为）
              writer.write({ type: 'message-metadata', messageMetadata: { modelId: value.response.modelId, timestamp: value.response.timestamp } });
              totalUsage = totalUsage ? addLanguageModelUsage(totalUsage, value.usage) : value.usage;
              writer.write({ type: 'finish-step' });
              break;

            case 'finish':
              // 最终 finish chunk 在 result 落定后统一写出
              break;

            case 'abort':
              // abort 由 result.status 判定写出，避免重复
              break;

            // ── 文本/推理：TextStreamPart 的 text 字段 → UIMessageChunk 的 delta 字段 ──
            case 'text-start':
            case 'text-end':
            case 'reasoning-start':
            case 'reasoning-end':
              writer.write({ type: value.type, id: value.id, providerMetadata: value.providerMetadata });
              break;

            case 'text-delta':
              fullText += value.text;
              writer.write({ type: 'text-delta', id: value.id, delta: value.text, providerMetadata: value.providerMetadata });
              break;

            case 'reasoning-delta':
              writer.write({ type: 'reasoning-delta', id: value.id, delta: value.text, providerMetadata: value.providerMetadata });
              break;

            // ── 工具事件 ──
            case 'tool-input-start':
              writer.write({ type: 'tool-input-start', toolCallId: value.id, toolName: value.toolName, providerExecuted: value.providerExecuted, dynamic: value.dynamic, title: value.title });
              break;

            case 'tool-input-delta':
              writer.write({ type: 'tool-input-delta', toolCallId: value.id, inputTextDelta: value.delta });
              break;

            case 'tool-input-end':
              break;

            case 'tool-call':
              writer.write({ type: 'tool-input-available', toolCallId: value.toolCallId, toolName: value.toolName, input: value.input, providerExecuted: value.providerExecuted, dynamic: value.dynamic });
              break;

            case 'tool-result':
              writer.write({ type: 'tool-output-available', toolCallId: value.toolCallId, output: value.output, providerExecuted: value.providerExecuted, dynamic: value.dynamic, preliminary: value.preliminary });
              break;

            case 'tool-error':
              writer.write({ type: 'tool-output-error', toolCallId: value.toolCallId, errorText: value.error instanceof Error ? value.error.message : String(value.error), providerExecuted: value.providerExecuted, dynamic: value.dynamic });
              break;

            case 'tool-output-denied':
              writer.write({ type: 'tool-output-denied', toolCallId: value.toolCallId });
              break;

            case 'tool-approval-request':
              writer.write({ type: 'tool-approval-request', approvalId: value.approvalId, toolCallId: value.toolCall.toolCallId });
              break;

            case 'tool-approval-response':
              writer.write({ type: 'tool-approval-response', approvalId: value.approvalId, approved: value.approved, reason: value.reason });
              break;

            // ── 来源/文件/自定义 ──
            case 'source':
              if (value.sourceType === 'url') {
                writer.write({ type: 'source-url', sourceId: value.id, url: value.url, title: value.title, providerMetadata: value.providerMetadata });
              } else {
                writer.write({ type: 'source-document', sourceId: value.id, mediaType: value.mediaType, title: value.title, filename: value.filename, providerMetadata: value.providerMetadata });
              }
              break;

            case 'file':
            case 'reasoning-file':
              writer.write({ type: value.type, url: toFileUrl(value.file), mediaType: value.file.mediaType, providerMetadata: value.providerMetadata });
              break;

            case 'custom':
              writer.write({ type: 'custom', kind: value.kind, providerMetadata: value.providerMetadata });
              break;

            case 'error':
              writer.write({ type: 'error', errorText: value.error instanceof Error ? value.error.message : String(value.error) });
              break;

            default:
              // raw：内部使用，不透出
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

      const finish: Extract<UIMessageChunk, { type: 'finish' }> = {
        type: 'finish',
        finishReason: result.status === 'completed' || result.status === 'paused' ? 'stop' : 'error',
        // usage 来自 finish-step part（引擎已转扁平 LanguageModelUsage），跨 step 累加
        messageMetadata: totalUsage ? { custom: { usage: totalUsage } } : undefined,
      };
      await options?.onFinish?.(finish, fullText);
      writer.write(finish);
    },
    onError: (e) => (e instanceof Error ? e.message : String(e)),
  });

  return createUIMessageStreamResponse({ stream });
}
