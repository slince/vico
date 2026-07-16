// packages/agent/__tests__/model/model-client.test.ts
import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import type { LanguageModelV4, LanguageModelV4CallOptions, LanguageModelV4StreamPart, LanguageModelV4StreamResult } from '@ai-sdk/provider';
import { ModelClient } from '../../src/model/model-client.js';
import { createTool } from '../../src/tool/create-tool.js';

/** 创建可控 doStream 的 mock LanguageModelV4 */
function createMockModel(
  doStreamFn: (opts: LanguageModelV4CallOptions) => Promise<LanguageModelV4StreamResult>,
): LanguageModelV4 {
  return {
    specificationVersion: 'v4',
    provider: 'mock',
    modelId: 'mock-model',
    supportedUrls: {},
    doGenerate: vi.fn(),
    doStream: doStreamFn,
  } as unknown as LanguageModelV4;
}

function streamOf(parts: LanguageModelV4StreamPart[]): ReadableStream<LanguageModelV4StreamPart> {
  return new ReadableStream({
    start(controller) {
      for (const p of parts) controller.enqueue(p);
      controller.close();
    },
  });
}

describe('ModelClient', () => {
  it('将 system+messages 转为 V4 prompt，工具转为 function tool，并透传采样参数', async () => {
    const doStream = vi.fn(async () => ({ stream: streamOf([]) }));
    const client = new ModelClient(createMockModel(doStream));

    const echo = createTool({
      name: 'echo', description: 'Echo', inputSchema: z.object({ message: z.string() }),
      execute: async (a) => a.message,
    });

    await client.stream({
      system: 'sys',
      messages: [{ role: 'user', content: 'hello' }],
      tools: [echo],
      maxOutputTokens: 100,
      temperature: 0.5,
      reasoning: 'low',
    });

    const opts: LanguageModelV4CallOptions = doStream.mock.calls[0][0];
    // system 进入 prompt 首条 system 消息
    expect(opts.prompt[0]).toEqual({ role: 'system', content: 'sys' });
    // user 消息转为 text part
    expect(opts.prompt[1]).toMatchObject({ role: 'user', content: [{ type: 'text', text: 'hello' }] });
    // 工具转换
    expect(opts.tools?.[0]).toMatchObject({ type: 'function', name: 'echo' });
    expect(opts.maxOutputTokens).toBe(100);
    expect(opts.temperature).toBe(0.5);
    expect(opts.reasoning).toBe('low');
  });

  it('透传 provider 原生流', async () => {
    const parts: LanguageModelV4StreamPart[] = [
      { type: 'text-start', id: 't1' },
      { type: 'text-delta', id: 't1', delta: 'hi' },
      { type: 'text-end', id: 't1' },
    ];
    const client = new ModelClient(createMockModel(async () => ({ stream: streamOf(parts) })));
    const { stream } = await client.stream({ messages: [{ role: 'user', content: 'q' }] });

    const received: LanguageModelV4StreamPart[] = [];
    for await (const chunk of stream) received.push(chunk);
    expect(received).toEqual(parts);
  });
});
