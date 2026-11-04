// @vico/stream-ag-ui - ag-ui 事件流 → SSE Response 编码。
import type {Event} from '@ag-ui/core';

/**
 * 把 ag-ui 事件流编码为 SSE Response。
 *
 * @param events - ag-ui Event 流（chunkToAgUiStream 输出）
 * @param headers - 追加的响应头（如 x-thread-id）
 * @returns text/event-stream 响应，每个事件序列化为 `data: <json>\n\n`
 */
export function aguiSSEResponse(events: ReadableStream<Event>, headers?: Record<string, string>): Response {
  const body = events.pipeThrough(new TransformStream<Event, string>({
    transform(event, controller) {
      controller.enqueue(`data: ${JSON.stringify(event)}\n\n`);
    },
  }));
  return new Response(body, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      ...headers,
    },
  });
}
