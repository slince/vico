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
import type { MastraModelOutput, MastraAgentNetworkStream, ChunkType } from '@mastra/core/stream';

/** createSSEStream 的可选回调参数 */
export interface SSEStreamCallbacks {
  /** 流结束后调用，接收完整响应文本，可用于事实提取等异步后处理 */
  onComplete?: (fullText: string) => void | Promise<void>;
}

/**
 * 将 MastraModelOutput 转换为符合 Vico 前端约定的 SSE ReadableStream。
 *
 * MastraModelOutput.textStream 是 node:stream/web ReadableStream，
 * 支持 for-await-of 异步迭代；toolCalls、toolResults、usage 均为
 * Promise getter，文本流消费完毕后自动 resolve。
 *
 * @param output - Mastra agent.stream() 返回的 MastraModelOutput 实例
 * @param callbacks - 可选回调（onComplete 在流结束后异步调用，不阻塞流关闭）
 * @returns 可直接作为 Hono SSE 响应体的 ReadableStream
 */
export function createSSEStream(
  output: MastraModelOutput<unknown>,
  callbacks?: SSEStreamCallbacks,
): ReadableStream {
  const encoder = new TextEncoder();

  return new ReadableStream({
    async start(controller) {
      /** 将对象序列化为 `data: {...}\n\n` 格式并写入流 */
      const enqueue = (data: unknown) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      try {
        // 1. 流式文本增量 — textStream 是 ReadableStream<string>，逐块吐出文本
        let fullText = '';
        for await (const chunk of output.textStream) {
          fullText += chunk;
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

          // exec 命令调用时，额外发出 approval_required 事件供 Web 端展示审批卡片
          if (p.toolName === 'mastra_workspace_execute_command' && p.args) {
            const args = p.args as Record<string, unknown>;
            const cmd = typeof args.command === 'string'
              ? args.command
              : JSON.stringify(p.args);
            enqueue({
              type: 'approval_required',
              toolName: p.toolName,
              command: cmd,
              message: `Exec command requires approval: ${cmd}`,
            });
          }
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

        // 6. 流结束后触发 onComplete 回调（fire-and-forget，不阻塞流关闭）
        if (callbacks?.onComplete) {
          Promise.resolve(callbacks.onComplete(fullText)).catch(() => {});
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

/**
 * 将 MastraAgentNetworkStream 转换为 SSE ReadableStream。
 *
 * MastraAgentNetworkStream 是 ReadableStream<ChunkType>，不含 textStream 等高级 getter。
 * 直接迭代原始 chunk，将 text-delta / tool-call / tool-result 映射为 SSE 事件。
 *
 * @param networkStream - supervisor.network() 返回的 MastraAgentNetworkStream
 * @returns Hono SSE 响应体
 */
export function createNetworkSSEStream(
  networkStream: MastraAgentNetworkStream,
): ReadableStream {
  const encoder = new TextEncoder();

  return new ReadableStream({
    async start(controller) {
      const enqueue = (data: unknown) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      try {
        const reader = (networkStream as unknown as ReadableStream<ChunkType>).getReader();
        let inputTokens = 0;
        let outputTokens = 0;

        while (true) {
          const { done, value: chunk } = await reader.read();
          if (done) break;

          if (!chunk || typeof chunk !== 'object' || !('type' in chunk)) continue;

          const c = chunk as { type: string; payload?: Record<string, unknown> };

          switch (c.type) {
            case 'text-delta':
            case 'routing-agent-text-delta':
              if (c.payload?.text && typeof c.payload.text === 'string') {
                enqueue({ type: 'text_delta', content: c.payload.text });
              }
              break;
            case 'tool-call':
              if (c.payload) {
                enqueue({
                  type: 'tool_call',
                  toolName: c.payload.toolName,
                  args: c.payload.args,
                });
              }
              break;
            case 'tool-result':
              if (c.payload) {
                enqueue({
                  type: 'tool_result',
                  toolName: c.payload.toolName,
                  result: c.payload.result,
                });
              }
              break;
          }
        }

        // 读取顶层 usage
        try {
          const netUsage = await networkStream.usage;
          inputTokens = netUsage.inputTokens;
          outputTokens = netUsage.outputTokens;
        } catch {
          // 忽略
        }

        enqueue({
          type: 'done',
          usage: { promptTokens: inputTokens, completionTokens: outputTokens },
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        enqueue({ type: 'error', message });
      } finally {
        controller.close();
      }
    },
  });
}
