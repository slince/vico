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
      const encoder = new TextEncoder();
      const enqueue = (chunk: unknown) => {
        controller.enqueue(encoder.encode(`0:${JSON.stringify(chunk)}\n`));
      };

      enqueue({ type: 'start' });

      try {
        let inStep = false;

        while (true) {
          const { done, value } = await generator.next();
          if (done) {
            const result = value as TurnResult;
            const totalUsage = result?.usage;
            const finishPayload: Record<string, unknown> = {
              type: 'finish',
              finishReason: result?.status === 'completed' ? 'stop' : 'error',
            };
            if (totalUsage) {
              finishPayload.totalUsage = {
                inputTokens: totalUsage.input,
                outputTokens: totalUsage.output,
              };
            }
            if (options?.doneMetadata) {
              finishPayload.messageMetadata = options.doneMetadata;
            }
            if (inStep) {
              enqueue({ type: 'finish-step' });
            }
            enqueue(finishPayload);
            break;
          }

          const event = value as TurnEvent;
          switch (event.type) {
            case 'text_delta':
              if (!inStep) {
                enqueue({ type: 'start-step' });
                inStep = true;
              }
              fullText += event.content;
              enqueue({ type: 'text-delta', text: event.content });
              break;

            case 'reasoning_delta':
              enqueue({ type: 'reasoning-delta', text: event.content });
              break;

            case 'tool_call_start':
              if (!inStep) {
                enqueue({ type: 'start-step' });
                inStep = true;
              }
              enqueue({
                type: 'tool-call',
                toolCallId: event.id,
                toolName: event.name,
                input: event.args,
              });
              break;

            case 'tool_result':
              enqueue({
                type: 'tool-result',
                toolCallId: event.id,
                toolName: event.name,
                result: event.status === 'success' ? String(event.output) : `Error: ${String(event.output)}`,
              });
              break;

            case 'step_end':
              if (inStep) {
                enqueue({ type: 'finish-step' });
                inStep = false;
              }
              break;

            case 'error':
              enqueue({ type: 'error', error: event.message });
              break;

            case 'step_start':
            case 'compacted':
              break;
          }
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        enqueue({ type: 'error', error: message });
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
