/**
 * TurnEvent 流 → AI SDK UI 流转换
 */
import { createUIMessageStreamResponse, type UIMessageChunk } from 'ai';
import type { TurnEvent, TurnResult } from '../agent-loop/types.js';

/** TurnEvent generator → AI SDK UI stream Response */
export async function turnEventsToAISDK(
  generator: AsyncGenerator<TurnEvent, TurnResult>,
  options?: { onComplete?: (fullText: string) => void | Promise<void> },
): Promise<Response> {
  let fullText = '';

  const stream = new ReadableStream<UIMessageChunk>({
    async start(controller) {
      const enqueue = (chunk: UIMessageChunk) => {
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

        while (true) {
          const { done, value } = await generator.next();
          if (done) {
            closeBlocks();
            const result = value as TurnResult;

            if (inStep) {
              enqueue({ type: 'finish-step' });
            }
            enqueue({
              type: 'finish',
              finishReason: result?.status === 'completed' ? 'stop' : 'error',
            });
            break;
          }

          const event = value as TurnEvent;
          switch (event.type) {
            case 'text-delta':
              closeReasoning();
              if (!inStep) { enqueue({ type: 'start-step' }); inStep = true; }
              if (!textId) {
                textId = crypto.randomUUID();
                enqueue({ type: 'text-start', id: textId });
              }
              fullText += event.content;
              enqueue({ type: 'text-delta', id: textId, delta: event.content });
              break;

            case 'reasoning-delta':
              closeText();
              if (!reasoningId) {
                reasoningId = crypto.randomUUID();
                enqueue({ type: 'reasoning-start', id: reasoningId });
              }
              enqueue({ type: 'reasoning-delta', id: reasoningId, delta: event.content });
              break;

            case 'tool-call-start':
              closeBlocks();
              if (!inStep) { enqueue({ type: 'start-step' }); inStep = true; }
              enqueue({ type: 'tool-input-start', toolCallId: event.id, toolName: event.name });
              enqueue({ type: 'tool-input-delta', toolCallId: event.id, inputTextDelta: JSON.stringify(event.args) });
              enqueue({ type: 'tool-input-available', toolCallId: event.id, toolName: event.name, input: event.args });
              break;

            case 'tool-result':
              if (event.status === 'success') {
                enqueue({ type: 'tool-output-available', toolCallId: event.id, output: event.output });
              } else {
                enqueue({ type: 'tool-output-error', toolCallId: event.id, errorText: String(event.output) });
              }
              break;

            case 'step-end':
              closeBlocks();
              if (inStep) { enqueue({ type: 'finish-step' }); inStep = false; }
              break;

            case 'error':
              enqueue({ type: 'error', errorText: event.message });
              break;

            case 'step-start':
            case 'compacted':
              break;
          }
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        enqueue({ type: 'error', errorText: message });
      } finally {
        controller.close();
      }
    },
  });

  const response = createUIMessageStreamResponse({
    stream,
    headers: {
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });

  if (options?.onComplete) {
    Promise.resolve(options.onComplete(fullText)).catch(() => {});
  }

  return response;
}
