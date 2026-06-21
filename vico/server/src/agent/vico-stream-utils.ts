/**
 * Vico TurnEvent → SSE / AI SDK 流转换工具
 */
import { createUIMessageStreamResponse } from 'ai';
import type { TurnEvent, TurnResult } from '@vico/agent';

export interface SSEStreamOptions {
  doneMetadata?: Record<string, unknown>;
  onComplete?: (fullText: string) => void | Promise<void>;
}

export interface AISDKStreamOptions {
  doneMetadata?: Record<string, unknown>;
  onComplete?: (fullText: string) => void | Promise<void>;
}

/** TurnEvent/Result 联合类型 */
type IterValue = TurnEvent | TurnResult;

export function turnEventsToSSE(
  generator: AsyncGenerator<TurnEvent, TurnResult>,
  options?: SSEStreamOptions,
): ReadableStream {
  const encoder = new TextEncoder();

  return new ReadableStream({
    async start(controller) {
      const enqueue = (data: unknown) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      let fullText = '';

      try {
        while (true) {
          const { done, value } = await generator.next();
          if (done) {
            const result = value as TurnResult;
            enqueue({
              type: 'done',
              usage: { promptTokens: result.usage.input, completionTokens: result.usage.output },
              ...options?.doneMetadata,
            });
            break;
          }

          const event = value as TurnEvent;
          switch (event.type) {
            case 'text_delta':
              fullText += event.content;
              enqueue({ type: 'text_delta', content: event.content });
              break;
            case 'reasoning_delta':
              enqueue({ type: 'reasoning_delta', content: event.content });
              break;
            case 'tool_call_start':
              enqueue({ type: 'tool_call', toolName: event.name, args: event.args });
              break;
            case 'tool_result':
              enqueue({
                type: 'tool_result',
                toolName: event.name,
                result: event.status === 'success' ? event.output : `Error: ${String(event.output)}`,
              });
              break;
            case 'step_start':
            case 'step_end':
            case 'compacted':
              break;
            case 'error':
              enqueue({ type: 'error', message: event.message });
              break;
          }
        }

        if (options?.onComplete) {
          Promise.resolve(options.onComplete(fullText)).catch(() => {});
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        enqueue({ type: 'error', message });
      } finally {
        controller.close();
      }
    },
  });
}

export async function turnEventsToAISDK(
  generator: AsyncGenerator<TurnEvent, TurnResult>,
  options?: AISDKStreamOptions,
): Promise<Response> {
  let fullText = '';

  const stream = new ReadableStream({
    async start(controller) {
      const enqueue = (chunk: unknown) => {
        controller.enqueue(chunk);
      };

      enqueue({ type: 'start' });

      try {
        let inStep = false;
        let textId: string | null = null;
        let reasoningId: string | null = null;

        const closeText = () => {
          if (textId) {
            enqueue({ type: 'text-end', id: textId });
            textId = null;
          }
        };
        const closeReasoning = () => {
          if (reasoningId) {
            enqueue({ type: 'reasoning-end', id: reasoningId });
            reasoningId = null;
          }
        };
        const closeBlocks = () => {
          closeText();
          closeReasoning();
        };

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
            case 'text_delta':
              closeReasoning();
              if (!inStep) {
                enqueue({ type: 'start-step' });
                inStep = true;
              }
              if (!textId) {
                textId = crypto.randomUUID();
                enqueue({ type: 'text-start', id: textId });
              }
              fullText += event.content;
              enqueue({ type: 'text-delta', id: textId, delta: event.content });
              break;

            case 'reasoning_delta':
              closeText();
              if (!reasoningId) {
                reasoningId = crypto.randomUUID();
                enqueue({ type: 'reasoning-start', id: reasoningId });
              }
              enqueue({ type: 'reasoning-delta', id: reasoningId, delta: event.content });
              break;

            case 'tool_call_start':
              closeBlocks();
              if (!inStep) {
                enqueue({ type: 'start-step' });
                inStep = true;
              }
              enqueue({ type: 'tool-input-start', toolCallId: event.id, toolName: event.name });
              enqueue({ type: 'tool-input-delta', toolCallId: event.id, inputTextDelta: JSON.stringify(event.args) });
              enqueue({ type: 'tool-input-available', toolCallId: event.id, toolName: event.name });
              break;

            case 'tool_result':
              if (event.status === 'success') {
                enqueue({ type: 'tool-output-available', toolCallId: event.id });
              } else {
                enqueue({ type: 'tool-output-error', toolCallId: event.id, errorText: String(event.output) });
              }
              break;

            case 'step_end':
              closeBlocks();
              if (inStep) {
                enqueue({ type: 'finish-step' });
                inStep = false;
              }
              break;

            case 'error':
              enqueue({ type: 'error', errorText: event.message });
              break;

            case 'step_start':
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
    stream: stream as any,
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
