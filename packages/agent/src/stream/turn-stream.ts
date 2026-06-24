/**
 * TurnOutput 流 → AI SDK UI 流转换
 */
import { createSSEResponse } from './sse.js';
import type { UIStreamChunk } from './types.js';
import type { TurnStreamChunk, TurnResult } from '../agent-loop/types.js';
import type { TurnOutput } from '../agent-loop/turn-output.js';

/** TurnOutput → AI SDK UI stream Response */
export async function turnEventsToAISDK(
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
        let textId: string | null = null;
        let reasoningId: string | null = null;

        const closeText = () => {
          if (textId) { enqueue({ type: 'text-end', id: textId }); textId = null; }
        };
        const closeReasoning = () => {
          if (reasoningId) { enqueue({ type: 'reasoning-end', id: reasoningId }); reasoningId = null; }
        };
        const closeBlocks = () => { closeText(); closeReasoning(); };

        const reader = output.stream.getReader();
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            switch (value.type) {
              case 'text-delta':
                closeReasoning();
                if (!inStep) { enqueue({ type: 'start-step' }); inStep = true; }
                if (!textId) {
                  textId = crypto.randomUUID();
                  enqueue({ type: 'text-start', id: textId });
                }
                fullText += value.content;
                enqueue({ type: 'text-delta', id: textId, delta: value.content });
                break;

              case 'reasoning-delta':
                closeText();
                if (!reasoningId) {
                  reasoningId = crypto.randomUUID();
                  enqueue({ type: 'reasoning-start', id: reasoningId });
                }
                enqueue({ type: 'reasoning-delta', id: reasoningId, delta: value.content });
                break;

              case 'tool-call':
                closeBlocks();
                if (!inStep) { enqueue({ type: 'start-step' }); inStep = true; }
                enqueue({ type: 'tool-input-start', toolCallId: value.id, toolName: value.name });
                enqueue({ type: 'tool-input-delta', toolCallId: value.id, inputTextDelta: JSON.stringify(value.args) });
                enqueue({ type: 'tool-input-available', toolCallId: value.id, toolName: value.name, input: value.args });
                break;

              case 'tool-result':
                if (value.status === 'success') {
                  enqueue({ type: 'tool-output-available', toolCallId: value.id, output: value.output });
                } else {
                  enqueue({ type: 'tool-output-error', toolCallId: value.id, errorText: String(value.output) });
                }
                break;

              case 'step-end':
                closeBlocks();
                if (inStep) { enqueue({ type: 'finish-step' }); inStep = false; }
                break;

              case 'error':
                enqueue({ type: 'error', errorText: value.message });
                break;

              case 'compacted':
                break;
            }
          }
        } finally {
          reader.releaseLock();
        }

        closeBlocks();

        const result: TurnResult = await output.result;

        if (inStep) {
          enqueue({ type: 'finish-step' });
        }
        const finish: UIStreamChunk = {
          type: 'finish',
          finishReason: result.status === 'completed' ? 'stop' : 'error',
        };
        await options?.onFinish?.(finish, fullText);
        enqueue(finish);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        enqueue({ type: 'error', errorText: message });
      } finally {
        controller.close();
      }
    },
  });

  const response = createSSEResponse(
    stream,
    {
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  );

  return response;
}
