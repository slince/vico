/**
 * `ChunkType` 流 → SSE Response。
 *
 * 投影规则（白名单式，避免把 provider 私有数据泄漏到前端）：
 * - 任意层级的 `providerMetadata` 丢弃：它是 provider 内部信息，前端不消费
 * - `raw` chunk 的 payload 清空：原始 provider 事件体积大且前端无渲染
 * - `Uint8Array` 转为 base64 字符串（文件类 payload 可能是二进制）
 */
import type {ChunkType} from '@vico/stream';

/** 递归深度的保护上限（payload 是 JSON 语义的数据，不该更深） */
const MAX_DEPTH = 12;

/**
 * 二进制转 base64（不依赖 Buffer，浏览器/边缘运行时同样可用）。
 *
 * @param bytes - 二进制数据
 * @returns base64 字符串
 */
function toBase64(bytes: Uint8Array): string {
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/**
 * 递归投影为 JSON 安全值。
 *
 * @param value - 原始值
 * @param depth - 当前递归深度
 * @returns 可 `JSON.stringify` 的值
 */
function project(value: unknown, depth: number): unknown {
  if (value === null || value === undefined) return value;
  if (depth > MAX_DEPTH) return undefined;
  if (value instanceof Uint8Array) return toBase64(value);
  if (Array.isArray(value)) {
    return value.map((item) => {
      const projected = project(item, depth + 1);
      return projected === undefined ? null : projected;
    });
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (key === 'providerMetadata') continue;
      const projected = project(item, depth + 1);
      if (projected !== undefined) out[key] = projected;
    }
    return out;
  }
  // function / symbol 之类不可序列化的值直接丢弃
  if (typeof value === 'function' || typeof value === 'symbol' || typeof value === 'bigint') return undefined;
  return value;
}

/**
 * 把引擎 chunk 投影为可下发的 JSON 对象。
 *
 * @param chunk - 引擎输出的 chunk
 * @returns JSON 安全对象
 */
export function toWireChunk(chunk: ChunkType): Record<string, unknown> {
  if (chunk.type === 'raw') {
    // 原始 provider 事件不透出（体积大且前端无消费点）
    return {type: 'raw', runId: chunk.runId, payload: {}};
  }
  return project(chunk, 0) as Record<string, unknown>;
}

/** SSE 响应头（与 ag-ui 时代的 header 保持一致，前端只依赖 `x-thread-id`） */
function sseHeaders(extra?: Record<string, string>): HeadersInit {
  return {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    ...extra,
  };
}

/**
 * chunk 来源统一为异步迭代器（引擎给的是 ReadableStream，测试桩给的是 generator）。
 *
 * @param input - ReadableStream 或 AsyncIterable
 * @returns AsyncIterable
 */
async function* iterateChunks(
  input: ReadableStream<ChunkType> | AsyncIterable<ChunkType>,
): AsyncGenerator<ChunkType> {
  if (typeof (input as AsyncIterable<ChunkType>)[Symbol.asyncIterator] === 'function') {
    yield* input as AsyncIterable<ChunkType>;
    return;
  }
  const reader = (input as ReadableStream<ChunkType>).getReader();
  try {
    while (true) {
      const {done, value} = await reader.read();
      if (done) return;
      yield value;
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * 把 chunk 流编码为 SSE Response（每帧 `data: <json>\n\n`）。
 *
 * @param chunks - chunk 流（ReadableStream 或 AsyncIterable）
 * @param headers - 追加响应头（如 `x-thread-id`）
 * @returns `text/event-stream` 响应
 */
export function chunkSSEResponse(
  chunks: ReadableStream<ChunkType> | AsyncIterable<ChunkType>,
  headers?: Record<string, string>,
): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const chunk of iterateChunks(chunks)) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(toWireChunk(chunk))}\n\n`));
        }
      } catch (error) {
        // 引擎在流中途抛错时，先把错误作为最后一帧下发，再把流正常关闭，
        // 让前端能区分「服务端出错」与「连接被切断」
        const message = error instanceof Error ? error.message : String(error);
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({type: 'error', runId: 'stream', payload: {error: message}})}\n\n`));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(body, {headers: sseHeaders(headers)});
}
