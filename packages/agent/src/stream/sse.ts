// @vico/agent - SSE 响应格式化（替代 ai 包的 createUIMessageStreamResponse）

const encoder = new TextEncoder();

/**
 * 从 ReadableStream 创建 SSE（Server-Sent Events）响应。
 * 每个 chunk 序列化为 `data: <JSON>\n\n` 格式。
 * @param stream - 要序列化为 SSE 的 ReadableStream
 * @param headers - 可选的额外响应头
 * @returns 配置好 Content-Type: text/event-stream 的 Response 对象
 */
export function createSSEResponse(
  stream: ReadableStream<unknown>,
  headers?: Record<string, string>,
): Response {
  const sseStream = new ReadableStream({
    async start(controller) {
      const reader = stream.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const line = `data: ${JSON.stringify(value)}\n\n`;
          controller.enqueue(encoder.encode(line));
        }
      } finally {
        reader.releaseLock();
        controller.close();
      }
    },
  });

  return new Response(sseStream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      ...headers,
    },
  });
}
