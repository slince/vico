/**
 * 统一的 SSE ReadableStream 工厂
 *
 * 从 MastraModelOutput.textStream 创建符合 Vico 前端格式的 SSE 流。
 * textStream 是 ReadableStream<string>，需要先消费流式文本增量，
 * 流结束后 toolCalls、toolResults、usage 等 Promise 才会 resolve。
 *
 * SSE 事件格式（与前端 streamChat / streamTeamChat 约定一致）:
 * - text_delta:  { type: 'text_delta', content: string }
 * - tool_call:   { type: 'tool_call', toolName: string, args: unknown }
 * - tool_result: { type: 'tool_result', toolName: string, result: string }
 * - done:        { type: 'done', usage: { promptTokens, completionTokens } }
 * - error:       { type: 'error', message: string }
 */
import type { MastraModelOutput } from '@mastra/core/stream';

/**
 * 将 MastraModelOutput 转换为符合 Vico 前端约定的 SSE ReadableStream。
 *
 * MastraModelOutput.textStream 是 node:stream/web ReadableStream，
 * 支持 for-await-of 异步迭代；toolCalls、toolResults、usage 均为
 * Promise getter，文本流消费完毕后自动 resolve。
 *
 * @param output - Mastra agent.stream() 返回的 MastraModelOutput 实例
 * @returns 可直接作为 Hono SSE 响应体的 ReadableStream
 */
export function createSSEStream(output: MastraModelOutput<unknown>): ReadableStream {
  const encoder = new TextEncoder();

  return new ReadableStream({
    async start(controller) {
      /** 将对象序列化为 `data: {...}\n\n` 格式并写入流 */
      const enqueue = (data: unknown) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      try {
        // 1. 流式文本增量 — textStream 是 ReadableStream<string>，逐块吐出文本
        for await (const chunk of output.textStream) {
          enqueue({ type: 'text_delta', content: chunk });
        }

        // 2. 文本流结束后，toolCalls / toolResults / usage 的 Promise 将 resolve
        //    使用 Promise.all + catch 保证其中任一失败不影响其余
        const [toolCalls, toolResults, usage] = await Promise.all([
          output.toolCalls.catch(() => []),
          output.toolResults.catch(() => []),
          output.usage.catch(() => undefined),
        ]);

        // 3. 逐条发出工具调用事件（payload 中存放 toolName / args）
        for (const tc of toolCalls) {
          const p = tc.payload;
          enqueue({ type: 'tool_call', toolName: p.toolName, args: p.args });
        }

        // 4. 逐条发出工具结果事件
        for (const tr of toolResults) {
          const p = tr.payload;
          enqueue({ type: 'tool_result', toolName: p.toolName, result: p.result });
        }

        // 5. 结束事件：带上 usage 信息（映射为前端期望的 promptTokens/completionTokens 字段）
        enqueue({
          type: 'done',
          usage: usage
            ? {
                promptTokens: usage.inputTokens ?? 0,
                completionTokens: usage.outputTokens ?? 0,
              }
            : {},
        });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        enqueue({ type: 'error', message });
      } finally {
        controller.close();
      }
    },
  });
}
