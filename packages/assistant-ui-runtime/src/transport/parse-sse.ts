/**
 * SSE 分帧解析：`text/event-stream` 字节流 → 每帧的 data 字符串。
 *
 * 只处理 AG-UI 时代之后我们实际会用到的语义：`data:`（可多行）、注释/心跳行（以 `:` 开头），
 * `event:` / `id:` / `retry:` 当前协议不产出，忽略。
 */

/**
 * 从单帧文本里取出 data 内容。
 *
 * @param frame - 一个完整帧（不含帧间的空行分隔）
 * @returns data 拼接结果；无 data 行（如纯注释帧）时返回 undefined
 */
export function extractSseData(frame: string): string | undefined {
  const dataLines: string[] = [];
  for (const line of frame.split('\n')) {
    if (line.startsWith(':')) continue;
    if (!line.startsWith('data:')) continue;
    // 规范要求去掉冒号后的单个前导空格
    dataLines.push(line.slice('data:'.length).replace(/^ /, ''));
  }
  if (dataLines.length === 0) return undefined;
  return dataLines.join('\n');
}

/**
 * 把 SSE 字节流解析成 data 帧的异步迭代器。
 *
 * 帧边界为连续两个换行；同时兼容 `\r\n`。流结束时缓冲区里剩余的半个帧也会被尝试解析，
 * 避免最后一帧缺尾随空行时被丢弃。
 *
 * @param stream - 响应体字节流
 * @returns data 字符串的异步迭代器
 */
export async function* iterateSseData(stream: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  const drain = function* (flush: boolean): Generator<string> {
    let index = buffer.indexOf('\n\n');
    while (index !== -1) {
      const frame = buffer.slice(0, index);
      buffer = buffer.slice(index + 2);
      const data = extractSseData(frame);
      if (data !== undefined) yield data;
      index = buffer.indexOf('\n\n');
    }
    if (flush && buffer.trim().length > 0) {
      const data = extractSseData(buffer);
      buffer = '';
      if (data !== undefined) yield data;
    }
  };

  try {
    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, {stream: true});
      if (buffer.includes('\r\n')) buffer = buffer.replace(/\r\n/g, '\n');
      yield* drain(false);
    }
    buffer += decoder.decode();
    if (buffer.includes('\r\n')) buffer = buffer.replace(/\r\n/g, '\n');
    yield* drain(true);
  } finally {
    reader.releaseLock();
  }
}
