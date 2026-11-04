// @vico/stream-ag-ui - ag-ui 事件流 → SSE Response 编码（经 @ag-ui/encoder 的 EventEncoder 分帧）。
import {EventEncoder} from '@ag-ui/encoder';
import type {Event} from '@ag-ui/core';

/**
 * 把 ag-ui 事件流编码为 SSE Response。
 *
 * 用 @ag-ui/encoder 的 EventEncoder 分帧：encodeSSE 内部经 omitOptionalNulls
 * 剥掉值为 null 的可选字段，产出符合 AG-UI 规范的事件；Content-Type 由 getContentType() 决定。
 *
 * @param events - ag-ui Event 流（createChunkToAgUiTransformer 输出）
 * @param headers - 追加的响应头（如 x-thread-id）
 * @returns text/event-stream 响应，每个事件序列化为 `data: <json>\n\n`
 */
export function aguiSSEResponse(events: ReadableStream<Event>, headers?: Record<string, string>): Response {
  const encoder = new EventEncoder();
  const body = events.pipeThrough(new TransformStream<Event, string>({
    transform(event, controller) {
      controller.enqueue(encoder.encode(event));
    },
  }));
  return new Response(body, {
    headers: {
      'Content-Type': encoder.getContentType(),
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      ...headers,
    },
  });
}
