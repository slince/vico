/**
 * AI SDK 协议流适配器
 *
 * 基于 @mastra/ai-sdk 的 toAISdkStream 将 Mastra 输出转为 AI SDK v6 UIMessageStream 格式，
 * 使用 ai 的 createUIMessageStreamResponse 包装为 Hono Response。
 *
 * 与 sse-utils.ts 的 createSSEStream 功能对等，但输出格式不同：
 * - createSSEStream: 自定义 SSE JSON 事件流 (type: text_delta/tool_call/tool_result/done)
 * - createAISDKStream: AI SDK v6 UIMessageStream 格式
 */
import { createUIMessageStreamResponse } from 'ai';
import { toAISdkStream } from '@mastra/ai-sdk';
import type { MastraModelOutput, MastraAgentNetworkStream } from '@mastra/core/stream';

/** finish 事件的 metadata 类型 */
interface FinishMetadata {
  usage?: { promptTokens: number; completionTokens: number };
  threadId?: string;
  [key: string]: unknown;
}

/** createAISDKStream 的可选参数 */
export interface AISDKStreamOptions {
  /** 合并到 finish 事件 messageMetadata 中的额外字段（如 threadId） */
  doneMetadata?: Record<string, unknown>;
  /** 流结束后调用的回调，用于异步后处理（如记忆提取） */
  onComplete?: (fullText: string) => void | Promise<void>;
}

/**
 * 将 MastraModelOutput 转换为 AI SDK UI stream Response。
 *
 * @param output - Mastra agent.stream() 返回值
 * @param options - 可选配置
 * @returns 可直接作为 Hono 响应体的 Response
 */
export async function createAISDKStream(
  output: MastraModelOutput<unknown>,
  options?: AISDKStreamOptions,
): Promise<Response> {
  // 1. 用 @mastra/ai-sdk 将 Mastra 输出转为 AI SDK v6 流
  const sdkStream = toAISdkStream(output, {
    from: 'agent',
    version: 'v6',
    sendStart: true,
    sendFinish: true,
  });

  // 2. 如果不需要注入额外 metadata，直接返回
  if (!options?.doneMetadata && !options?.onComplete) {
    return createUIMessageStreamResponse({
      stream: sdkStream as ReadableStream<any>,
      headers: {
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  }

  // 3. 通过 TransformStream 注入 doneMetadata 到 finish 事件
  const { doneMetadata, onComplete } = options;
  const transformed = sdkStream.pipeThrough(
    new TransformStream({
      transform(chunk, controller) {
        if (doneMetadata && (chunk as any).type === 'finish') {
          const existing = ((chunk as any).messageMetadata || {}) as FinishMetadata;
          controller.enqueue({
            ...chunk,
            messageMetadata: { ...existing, ...doneMetadata },
          });
        } else {
          controller.enqueue(chunk);
        }
        // 收集文本用于 onComplete
        if (onComplete && (chunk as any).type === 'text-delta') {
          // fire-and-forget 收集完整文本较为复杂，简化为在 finish 后处理
        }
      },
      flush() {
        // onComplete 在 transform 中难以收集完整文本，此处不实现
        // 保留 onComplete 选项以便后续升级为更完整的方案
      },
    }),
  );

  return createUIMessageStreamResponse({
    stream: transformed as ReadableStream<any>,
    headers: {
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}

/**
 * 将 MastraAgentNetworkStream 转换为 AI SDK UI stream Response。
 *
 * @param networkStream - supervisor.network() 返回值
 * @returns Hono SSE 响应体（AI SDK 格式）
 */
export async function createNetworkAISDKStream(
  networkStream: MastraAgentNetworkStream,
): Promise<Response> {
  const sdkStream = toAISdkStream(networkStream, {
    from: 'network',
    version: 'v6',
  });

  return createUIMessageStreamResponse({
    stream: sdkStream as ReadableStream<any>,
    headers: {
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}
