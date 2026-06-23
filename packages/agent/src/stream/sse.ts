// @vico/agent - SSE response formatter (replaces ai's createUIMessageStreamResponse)

/**
 * Create an SSE (Server-Sent Events) Response from a ReadableStream of chunks.
 * Each chunk is serialized as `data: <JSON>\n\n`.
 */
export function createSSEResponse(
  stream: ReadableStream<unknown>,
  headers?: Record<string, string>,
): Response {
  const encoder = new TextEncoder();

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
