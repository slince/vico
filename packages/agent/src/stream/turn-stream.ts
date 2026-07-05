/**
 * TurnOutput 流（ModelStreamChunk）→ AI SDK UI 流（UIStreamChunk）转换。
 * ModelStreamChunk 来自 AI SDK provider 层，UIStreamChunk 供 @assistant-ui/react 消费。
 */
import {createSSEResponse} from './sse.js';
import type {UIStreamChunk} from './types.js';
import type {TurnResult} from '../agent-loop/types.js';
import type {TurnOutput} from '../agent-loop/turn-output.js';

/**
 * TurnOutput 流（ModelStreamChunk）→ AI SDK UI 流（UIStreamChunk）转换。
 * 将 ModelStreamChunk 转换为 UIStreamChunk 格式，封装为 SSE Response 供 @assistant-ui/react 消费。
 * @param output - TurnOutput 实例，包含模型流和结果 Promise
 * @param options - 可选配置，包含 onFinish 回调
 * @returns SSE 格式的 Response 对象
 */
export async function turnOutputToSSEResponse(
  output: TurnOutput,
  options?: { onFinish?: (finish: Extract<UIStreamChunk, { type: 'finish' }>, fullText: string) => void | Promise<void> },
): Promise<Response> {
  let fullText = '';

  const stream = new ReadableStream<UIStreamChunk>({
    async start(controller) {
      const enqueue = (chunk: UIStreamChunk) => controller.enqueue(chunk);

      enqueue({ type: 'start' });

      try {
        let inStep = false;
        const reader = output.stream.getReader();
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            switch (value.type) {
              // ── 透传：与 UIStreamChunk 字段一致 ──
              case 'text-start':
                if (!inStep) { enqueue({ type: 'start-step' }); inStep = true; }
                enqueue(value);
                break;

              case 'text-delta':
                fullText += value.delta;
                enqueue(value);
                break;

              case 'text-end':
              case 'reasoning-start':
              case 'reasoning-delta':
              case 'reasoning-end':
              case 'tool-output-denied':
                enqueue(value);
                break;

              // ── 字段映射 ──
              case 'tool-input-start':
                enqueue({ type: 'tool-input-start', toolCallId: value.id, toolName: value.toolName });
                break;

              case 'tool-input-delta':
                enqueue({ type: 'tool-input-delta', toolCallId: value.id, inputTextDelta: value.delta });
                break;

              case 'tool-input-end':
                break;

              case 'tool-call':
                enqueue({ type: 'tool-input-available', toolCallId: value.toolCallId, toolName: value.toolName, input: value.input });
                break;

              case 'tool-result':
                if (value.isError) {
                  enqueue({ type: 'tool-output-error', toolCallId: value.toolCallId, errorText: String(value.result) });
                } else {
                  enqueue({ type: 'tool-output-available', toolCallId: value.toolCallId, output: value.result });
                }
                break;

              case 'tool-approval-request':
                enqueue({ type: 'tool-approval-request', approvalId: value.approvalId, toolCallId: value.toolCallId });
                break;

              case 'source':
                if (value.sourceType === 'url') {
                  enqueue({ type: 'source-url', sourceId: value.id, url: value.url, title: value.title, providerMetadata: value.providerMetadata });
                } else {
                  enqueue({ type: 'source-document', sourceId: value.id, mediaType: value.mediaType, title: value.title, filename: value.filename, providerMetadata: value.providerMetadata });
                }
                break;

              case 'file':
                enqueue({
                  type: 'file',
                  url: typeof value.data === 'string' ? value.data : `data:${value.mediaType};base64,${Buffer.from(value.data).toString('base64')}`,
                  mediaType: value.mediaType,
                  providerMetadata: value.providerMetadata,
                });
                break;

              case 'response-metadata':
                enqueue({ type: 'message-metadata', messageMetadata: { modelId: value.modelId, timestamp: value.timestamp } });
                break;

              case 'finish':
                break;

              case 'error':
                enqueue({ type: 'error', errorText: value.error instanceof Error ? value.error.message : String(value.error) });
                break;

              default:
                break;
            }
          }
        } finally {
          reader.releaseLock();
        }

        const result: TurnResult = await output.result;

        if (result.status === 'aborted') {
          enqueue({ type: 'abort' });
        }
        if (result.status === 'paused') {
          enqueue({ type: 'data-turn-paused', data: { reason: 'tool-approval', turnId: result.turn.id } });
        }
        if (inStep) {
          enqueue({ type: 'finish-step' });
        }
        const finish: UIStreamChunk = {
          type: 'finish',
          finishReason: result.status === 'completed' ? 'stop' : result.status === 'paused' ? 'stop' : 'error',
        };
        await options?.onFinish?.(finish, fullText);
        enqueue(finish);
      } finally {
        controller.close();
      }
    },
  });

  return createSSEResponse(
    stream,
    {
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  );
}
