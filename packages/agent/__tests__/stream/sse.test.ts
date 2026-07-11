import { describe, it, expect } from 'vitest';
import { createSSEResponse } from '../../src/stream/sse.js';
import type { UIStreamChunk } from '../../src/stream/types.js';

async function readSSEBody(response: Response): Promise<string[]> {
  const text = await response.text();
  return text.split('\n\n').filter(Boolean);
}

describe('createSSEResponse', () => {
  it('returns a Response with text/event-stream content type', () => {
    const stream = new ReadableStream<UIStreamChunk>({
      start(c) { c.enqueue({ type: 'start' }); c.close(); },
    });
    const response = createSSEResponse(stream);
    expect(response.headers.get('Content-Type')).toBe('text/event-stream');
  });

  it('formats chunks as SSE data lines', async () => {
    const stream = new ReadableStream<UIStreamChunk>({
      start(c) {
        c.enqueue({ type: 'start' });
        c.enqueue({ type: 'text-delta', id: 't1', delta: 'Hello' });
        c.enqueue({ type: 'finish', finishReason: 'stop' });
        c.close();
      },
    });
    const response = createSSEResponse(stream);
    const lines = await readSSEBody(response);
    expect(lines).toEqual([
      'data: {"type":"start"}',
      'data: {"type":"text-delta","id":"t1","delta":"Hello"}',
      'data: {"type":"finish","finishReason":"stop"}',
    ]);
  });

  it('sets custom headers', () => {
    const stream = new ReadableStream<UIStreamChunk>({
      start(c) { c.close(); },
    });
    const response = createSSEResponse(stream, {
      'Cache-Control': 'no-cache',
      'X-Custom': 'test',
    });
    expect(response.headers.get('Cache-Control')).toBe('no-cache');
    expect(response.headers.get('X-Custom')).toBe('test');
  });

  it('includes default headers (Cache-Control, Connection)', () => {
    const stream = new ReadableStream<UIStreamChunk>({
      start(c) { c.close(); },
    });
    const response = createSSEResponse(stream);
    expect(response.headers.get('Cache-Control')).toBe('no-cache');
    expect(response.headers.get('Connection')).toBe('keep-alive');
  });
});
