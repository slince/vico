/**
 * 默认传输实现：POST + `text/event-stream`，逐帧 JSON 反序列化为 `ChunkType`。
 *
 * 协议约定（与服务端 `@vico/stream-wire` 一致）：
 * - 请求体为 `VicoRunRequest`
 * - 响应每帧 `data: <ChunkType JSON>`
 * - 真实线程 id 经响应头 `x-thread-id` 下发（ChunkType 本身不含 threadId）
 */
import type {AgentMessage} from '@vico/model';
import type {ChunkType} from '@vico/stream';
import type {VicoTransport} from '../types.js';
import {iterateSseData} from './parse-sse.js';

export interface SseTransportOptions {
  /** chat 端点，默认 `/api/v1/chat` */
  url?: string;
  /** 历史端点，默认 `/api/v1/threads/:id` */
  threadUrl?: (threadId: string) => string;
  /** 注入 fetch（测试/SSR 场景替换） */
  fetch?: typeof fetch;
}

/** 从错误响应体里取出可读信息（优先后端 `{error}` 结构） */
async function readErrorBody(response: Response): Promise<string> {
  try {
    const text = await response.text();
    try {
      const parsed = JSON.parse(text) as {error?: unknown};
      if (typeof parsed.error === 'string') return parsed.error;
    } catch {
      // 非 JSON：直接返回原文
    }
    return text.slice(0, 500);
  } catch {
    return '';
  }
}

/**
 * 把响应体字节流解析为 chunk 流；单帧 JSON 解析失败只跳过该帧，不打断整条流。
 *
 * @param body - 响应体
 * @returns ChunkType 异步迭代器
 */
async function* toChunkStream(body: ReadableStream<Uint8Array>): AsyncGenerator<ChunkType> {
  for await (const data of iterateSseData(body)) {
    try {
      yield JSON.parse(data) as ChunkType;
    } catch {
      continue;
    }
  }
}

/**
 * 创建 SSE 传输。
 *
 * @param options - 端点与 fetch 注入
 * @returns 满足 `VicoTransport` 的实现
 */
export function createSseTransport(options: SseTransportOptions = {}): VicoTransport {
  const {
    url = '/api/v1/chat',
    threadUrl = (threadId: string) => `/api/v1/threads/${encodeURIComponent(threadId)}`,
    fetch: fetchImpl = fetch,
  } = options;

  return {
    async run(request, {signal}) {
      const response = await fetchImpl(url, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify(request),
        signal,
      });

      if (!response.ok) {
        const detail = await readErrorBody(response);
        throw new Error(`chat request failed (${response.status})${detail ? `: ${detail}` : ''}`);
      }
      if (!response.body) throw new Error('chat response has no body');

      const threadId = response.headers.get('x-thread-id') ?? undefined;
      return {
        ...(threadId !== undefined && {threadId}),
        chunks: toChunkStream(response.body),
      };
    },

    async loadMessages(threadId) {
      const response = await fetchImpl(threadUrl(threadId), {
        headers: {accept: 'application/json'},
      });
      if (!response.ok) {
        const detail = await readErrorBody(response);
        throw new Error(`load thread failed (${response.status})${detail ? `: ${detail}` : ''}`);
      }
      const data = (await response.json()) as {messages?: AgentMessage[]};
      return data.messages ?? [];
    },
  };
}
