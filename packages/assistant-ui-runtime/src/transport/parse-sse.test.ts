import {describe, expect, it} from 'vitest';
import {extractSseData, iterateSseData} from './parse-sse.js';

const encoder = new TextEncoder();

function streamOf(...chunks: string[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

async function collect(stream: ReadableStream<Uint8Array>): Promise<string[]> {
  const out: string[] = [];
  for await (const data of iterateSseData(stream)) out.push(data);
  return out;
}

describe('extractSseData', () => {
  it('取单行 data 并去掉一个前导空格', () => {
    expect(extractSseData('data: {"a":1}')).toBe('{"a":1}');
  });

  it('多行 data 用换行拼接', () => {
    expect(extractSseData('data: line1\ndata: line2')).toBe('line1\nline2');
  });

  it('忽略注释行与 event/id 行', () => {
    expect(extractSseData(': heartbeat\nevent: x\nid: 1\ndata: {"a":1}')).toBe('{"a":1}');
  });

  it('无 data 行返回 undefined', () => {
    expect(extractSseData(': heartbeat')).toBeUndefined();
    expect(extractSseData('')).toBeUndefined();
  });
});

describe('iterateSseData', () => {
  it('按空行分帧', async () => {
    const frames = await collect(streamOf('data: {"a":1}\n\ndata: {"b":2}\n\n'));
    expect(frames).toEqual(['{"a":1}', '{"b":2}']);
  });

  it('一帧跨多个网络分片仍能拼回', async () => {
    const frames = await collect(streamOf('data: {"te', 'xt":"南京"}\n\n'));
    expect(frames).toEqual(['{"text":"南京"}']);
  });

  it('兼容 CRLF', async () => {
    const frames = await collect(streamOf('data: {"a":1}\r\n\r\n'));
    expect(frames).toEqual(['{"a":1}']);
  });

  it('最后一帧缺少尾随空行时，流结束也要吐出', async () => {
    const frames = await collect(streamOf('data: {"a":1}\n\ndata: {"b":2}'));
    expect(frames).toEqual(['{"a":1}', '{"b":2}']);
  });

  it('纯注释帧被跳过', async () => {
    const frames = await collect(streamOf(': ping\n\ndata: {"a":1}\n\n'));
    expect(frames).toEqual(['{"a":1}']);
  });
});
