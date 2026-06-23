import { describe, it, expect, vi } from 'vitest';
import { ModelClient } from '../model-client.js';
import type { LanguageModelV3, LanguageModelV3CallOptions, LanguageModelV3StreamResult } from '@ai-sdk/provider';
import type { ModelStreamChunk } from '../types.js';

/** Create a mock LanguageModelV3 with controllable doStream */
function createMockModel(
  doStreamFn: (opts: LanguageModelV3CallOptions) => Promise<LanguageModelV3StreamResult>,
): LanguageModelV3 {
  return {
    specificationVersion: 'v3',
    provider: 'mock',
    modelId: 'mock-model',
    supportedUrls: {},
    doGenerate: vi.fn().mockRejectedValue(new Error('not implemented')),
    doStream: vi.fn().mockImplementation(doStreamFn),
  };
}

describe('ModelClient', () => {
  it('calls model.doStream with converted prompt and tools', async () => {
    const doStream = vi.fn().mockResolvedValue({
      stream: new ReadableStream({
        start(c) {
          c.enqueue({ type: 'text-delta', id: 't1', delta: 'Hi' });
          c.close();
        },
      }),
    });

    const model = createMockModel(doStream);
    const client = new ModelClient(model);

    const { stream } = await client.stream({
      system: 'be helpful',
      messages: [{ role: 'user', content: 'Hello' }],
      tools: [{ name: 'search', description: 'Search', inputSchema: { type: 'object', properties: {} } }],
      maxOutputTokens: 100,
      temperature: 0.5,
    });

    expect(doStream).toHaveBeenCalledTimes(1);
    const callOpts: LanguageModelV3CallOptions = doStream.mock.calls[0][0];

    // Check prompt
    expect(callOpts.prompt).toEqual([
      { role: 'system', content: 'be helpful' },
      { role: 'user', content: [{ type: 'text', text: 'Hello' }] },
    ]);

    // Check tools
    expect(callOpts.tools).toEqual([{
      type: 'function',
      name: 'search',
      description: 'Search',
      inputSchema: { type: 'object', properties: {} },
    }]);

    // Check options forwarded
    expect(callOpts.maxOutputTokens).toBe(100);
    expect(callOpts.temperature).toBe(0.5);

    // Consume stream
    const chunks: ModelStreamChunk[] = [];
    for await (const c of stream) chunks.push(c);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].type).toBe('text-delta');
  });

  it('works without tools', async () => {
    const doStream = vi.fn().mockResolvedValue({
      stream: new ReadableStream({ start(c) { c.close(); } }),
    });
    const model = createMockModel(doStream);
    const client = new ModelClient(model);

    await client.stream({
      messages: [{ role: 'user', content: 'Hi' }],
    });

    expect(doStream.mock.calls[0][0].tools).toBeUndefined();
  });

  it('passes abortSignal through', async () => {
    const doStream = vi.fn().mockResolvedValue({
      stream: new ReadableStream({ start(c) { c.close(); } }),
    });
    const model = createMockModel(doStream);
    const client = new ModelClient(model);
    const signal = new AbortController().signal;

    await client.stream({ messages: [{ role: 'user', content: 'Hi' }], abortSignal: signal });
    expect(doStream.mock.calls[0][0].abortSignal).toBe(signal);
  });
});
