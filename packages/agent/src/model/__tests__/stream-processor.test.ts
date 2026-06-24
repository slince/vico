import { describe, it, expect } from 'vitest';
import { processStreamParts } from '../stream-processor.js';
import type { LanguageModelV3StreamPart } from '@ai-sdk/provider';
import type { ModelStreamChunk } from '../types.js';

/** Helper: create a readable stream from LanguageModelV3StreamPart array */
function createMockStream(parts: LanguageModelV3StreamPart[]): ReadableStream<LanguageModelV3StreamPart> {
  return new ReadableStream({
    start(controller) {
      for (const part of parts) {
        controller.enqueue(part);
      }
      controller.close();
    },
  });
}

/** Helper: collect all chunks from async generator */
async function collect<T>(gen: AsyncGenerator<T>): Promise<T[]> {
  const items: T[] = [];
  for await (const item of gen) {
    items.push(item);
  }
  return items;
}

describe('processStreamParts', () => {
  it('processes text lifecycle events', async () => {
    const stream = createMockStream([
      { type: 'text-start', id: 't1' },
      { type: 'text-delta', id: 't1', delta: 'Hello' },
      { type: 'text-delta', id: 't1', delta: ' World' },
      { type: 'text-end', id: 't1' },
    ]);
    const chunks = await collect(processStreamParts(stream));
    expect(chunks).toEqual([
      { type: 'text-start', id: 't1' },
      { type: 'text-delta', id: 't1', delta: 'Hello' },
      { type: 'text-delta', id: 't1', delta: ' World' },
      { type: 'text-end', id: 't1' },
    ]);
  });

  it('processes reasoning lifecycle events', async () => {
    const stream = createMockStream([
      { type: 'reasoning-start', id: 'r1' },
      { type: 'reasoning-delta', id: 'r1', delta: 'thinking...' },
      { type: 'reasoning-end', id: 'r1' },
    ]);
    const chunks = await collect(processStreamParts(stream));
    expect(chunks).toEqual([
      { type: 'reasoning-start', id: 'r1' },
      { type: 'reasoning-delta', id: 'r1', delta: 'thinking...' },
      { type: 'reasoning-end', id: 'r1' },
    ]);
  });

  it('processes tool call with buffered deltas', async () => {
    const stream = createMockStream([
      { type: 'tool-input-start', id: 'tc1', toolName: 'search' },
      { type: 'tool-input-delta', id: 'tc1', delta: '{"q":' },
      { type: 'tool-input-delta', id: 'tc1', delta: '"hello"}' },
      { type: 'tool-input-end', id: 'tc1' },
      { type: 'tool-call', toolCallId: 'tc1', toolName: 'search', input: '{"q":"hello"}' },
    ]);
    const chunks = await collect(processStreamParts(stream));

    expect(chunks).toHaveLength(5);
    expect(chunks[4]).toEqual({
      type: 'tool-call',
      toolCallId: 'tc1',
      toolName: 'search',
      input: { q: 'hello' },
      providerExecuted: undefined,
      dynamic: undefined,
      providerMetadata: undefined,
    });
  });

  it('falls back to buffer when tool-call input parsing fails', async () => {
    const stream = createMockStream([
      { type: 'tool-input-start', id: 'tc1', toolName: 'bad' },
      { type: 'tool-input-delta', id: 'tc1', delta: 'valid json' },
      { type: 'tool-input-end', id: 'tc1' },
      { type: 'tool-call', toolCallId: 'tc1', toolName: 'bad', input: 'not-valid-json' },
    ]);
    const chunks = await collect(processStreamParts(stream));
    // Should fallback to buffer'd text (4 chunks: start, delta, end, call)
    expect(chunks).toHaveLength(4);
    expect(chunks[3].type).toBe('tool-call');
    expect(chunks[3]).toMatchObject({
      type: 'tool-call',
      toolCallId: 'tc1',
      toolName: 'bad',
      input: 'valid json',
    });
  });

  it('processes finish event with usage', async () => {
    const stream = createMockStream([
      {
        type: 'finish',
        finishReason: { unified: 'stop', raw: 'stop' },
        usage: {
          inputTokens: { total: 100, noCache: 50, cacheRead: 30, cacheWrite: 20 },
          outputTokens: { total: 50, text: 50, reasoning: 0 },
        },
      },
    ]);
    const chunks = await collect(processStreamParts(stream));
    expect(chunks).toEqual([{
      type: 'finish',
      finishReason: { unified: 'stop', raw: 'stop' },
      usage: {
        inputTokens: { total: 100, noCache: 50, cacheRead: 30, cacheWrite: 20 },
        outputTokens: { total: 50, text: 50, reasoning: 0 },
      },
      providerMetadata: undefined,
    }]);
  });

  it('processes error event', async () => {
    const err = new Error('API error');
    const stream = createMockStream([
      { type: 'error', error: err },
    ]);
    const chunks = await collect(processStreamParts(stream));
    expect(chunks[0]).toMatchObject({
      type: 'error',
      error: expect.any(Error),
    });
  });

  it('processes stream-start with warnings', async () => {
    const stream = createMockStream([
      { type: 'stream-start', warnings: [{ type: 'unsupported', feature: 'top_k' }] },
    ]);
    const chunks = await collect(processStreamParts(stream));
    expect(chunks).toEqual([{
      type: 'stream-start',
      warnings: [{ type: 'unsupported', feature: 'top_k' }],
    }]);
  });

  it('processes tool-result from provider', async () => {
    const stream = createMockStream([
      { type: 'tool-result', toolCallId: 'tc1', toolName: 'search', result: { answer: '42' }, isError: false },
    ]);
    const chunks = await collect(processStreamParts(stream));
    expect(chunks).toEqual([{
      type: 'tool-result',
      toolCallId: 'tc1',
      toolName: 'search',
      result: { answer: '42' },
      isError: false,
      preliminary: undefined,
      dynamic: undefined,
      providerMetadata: undefined,
    }]);
  });

  it('processes tool-approval-request', async () => {
    const stream = createMockStream([
      { type: 'tool-approval-request', approvalId: 'a1', toolCallId: 'tc1' },
    ]);
    const chunks = await collect(processStreamParts(stream));
    expect(chunks).toEqual([{
      type: 'tool-approval-request',
      approvalId: 'a1',
      toolCallId: 'tc1',
      providerMetadata: undefined,
    }]);
  });

  it('processes file and source events', async () => {
    const stream = createMockStream([
      { type: 'file', mediaType: 'image/png', data: 'base64...' },
      { type: 'source', sourceType: 'url', id: 's1', url: 'https://example.com' },
    ]);
    const chunks = await collect(processStreamParts(stream));
    expect(chunks).toEqual([
      { type: 'file', mediaType: 'image/png', data: 'base64...', providerMetadata: undefined },
      { type: 'source', sourceType: 'url', id: 's1', url: 'https://example.com', title: undefined, providerMetadata: undefined },
    ]);
  });

  it('processes response-metadata and raw events', async () => {
    const stream = createMockStream([
      { type: 'response-metadata', id: 'resp1', timestamp: new Date('2026-01-01'), modelId: 'gpt-4o' },
      { type: 'raw', rawValue: { x: 1 } },
    ]);
    const chunks = await collect(processStreamParts(stream));
    expect(chunks).toEqual([
      { type: 'response-metadata', id: 'resp1', timestamp: new Date('2026-01-01'), modelId: 'gpt-4o' },
      { type: 'raw', rawValue: { x: 1 } },
    ]);
  });

  it('handles empty stream', async () => {
    const stream = createMockStream([]);
    const chunks = await collect(processStreamParts(stream));
    expect(chunks).toEqual([]);
  });
});
