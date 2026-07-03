/**
 * TurnOutput 流（ModelStreamChunk）→ AI SDK UI 流（UIStreamChunk）转换。
 * ModelStreamChunk 来自 AI SDK provider 层，UIStreamChunk 供 @assistant-ui/react 消费。
 */
import {createSSEResponse} from './sse.js';
import type {UIStreamChunk} from './types.js';
import type {TurnResult} from '../agent-loop/types.js';
import type {TurnOutput} from '../agent-loop/turn-output.js';
import type {ModelStreamChunk} from '../model/types.js';

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
      const enqueue = (chunk: UIStreamChunk) => {
        controller.enqueue(chunk);
      };

      enqueue({ type: 'start' });

      try {
        let inStep = false;
        const reader = output.stream.getReader();
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const c = value as ModelStreamChunk;

            switch (c.type) {
              case 'text-start':
                if (!inStep) { enqueue({ type: 'start-step' }); inStep = true; }
                enqueue({ type: 'text-start', id: c.id, providerMetadata: c.providerMetadata });
                break;

              case 'text-delta':
                fullText += c.delta;
                enqueue({ type: 'text-delta', id: c.id, delta: c.delta, providerMetadata: c.providerMetadata });
                break;

              case 'text-end':
                enqueue({ type: 'text-end', id: c.id, providerMetadata: c.providerMetadata });
                break;

              case 'reasoning-start':
                enqueue({ type: 'reasoning-start', id: c.id, providerMetadata: c.providerMetadata });
                break;

              case 'reasoning-delta':
                enqueue({ type: 'reasoning-delta', id: c.id, delta: c.delta, providerMetadata: c.providerMetadata });
                break;

              case 'reasoning-end':
                enqueue({ type: 'reasoning-end', id: c.id, providerMetadata: c.providerMetadata });
                break;

              case 'tool-input-start':
                enqueue({ type: 'tool-input-start', toolCallId: c.id, toolName: c.toolName });
                break;

              case 'tool-input-delta':
                enqueue({ type: 'tool-input-delta', toolCallId: c.id, inputTextDelta: c.delta });
                break;

              case 'tool-input-end':
                // tool-input 流式结束，tool-call 会紧随发出 tool-input-available
                break;

              case 'tool-call':
                enqueue({ type: 'tool-input-available', toolCallId: c.toolCallId, toolName: c.toolName, input: c.input });
                break;

              case 'tool-result':
                if (c.isError) {
                  enqueue({ type: 'tool-output-error', toolCallId: c.toolCallId, errorText: String(c.result) });
                } else {
                  enqueue({ type: 'tool-output-available', toolCallId: c.toolCallId, output: c.result });
                }
                break;

              case 'tool-approval-request':
                // AI SDK strictObject schema 只接受 approvalId + toolCallId + signature，不允许 toolName/input
                enqueue({ type: 'tool-approval-request', approvalId: c.approvalId, toolCallId: c.toolCallId });
                break;

              case 'tool-output-denied':
                enqueue({ type: 'tool-output-denied', toolCallId: c.toolCallId });
                break;

              case 'source':
                if (c.sourceType === 'url') {
                  enqueue({ type: 'source-url', sourceId: c.id, url: c.url, title: c.title, providerMetadata: c.providerMetadata });
                } else {
                  enqueue({ type: 'source-document', sourceId: c.id, mediaType: c.mediaType, title: c.title, filename: c.filename, providerMetadata: c.providerMetadata });
                }
                break;

              case 'file':
                enqueue({ type: 'file', url: typeof c.data === 'string' ? c.data : `data:${c.mediaType};base64,${Buffer.from(c.data).toString('base64')}`, mediaType: c.mediaType, providerMetadata: c.providerMetadata });
                break;

              case 'response-metadata':
                enqueue({ type: 'message-metadata', messageMetadata: { modelId: c.modelId, timestamp: c.timestamp } });
                break;

              case 'finish':
                break;

              case 'error':
                const errMsg = c.error instanceof Error ? c.error.message : String(c.error);
                enqueue({ type: 'error', errorText: errMsg });
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
          enqueue({ type: 'data-turn-paused', data: { reason: 'tool-approval', turnId: result.turnId ?? '' } });
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
