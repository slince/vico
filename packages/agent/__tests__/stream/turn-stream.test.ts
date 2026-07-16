// packages/agent/__tests__/stream/turn-stream.test.ts
import { describe, it, expect } from 'vitest';
import type { LanguageModelV4StreamPart } from '@ai-sdk/provider';
import type { UIMessageChunk } from 'ai';
import { TurnOutput } from '../../src/agent-loop/turn-output.js';
import { turnOutputToSSEResponse } from '../../src/stream/turn-stream.js';
import type { TurnResult } from '../../src/agent-loop/agent-loop-options.js';

function makeOutput(parts: LanguageModelV4StreamPart[], result: Partial<TurnResult> = {}): TurnOutput {
  const stream = new ReadableStream<LanguageModelV4StreamPart>({
    start(c) { for (const p of parts) c.enqueue(p); c.close(); },
  });
  const turnResult = {
    status: 'completed', steps: 1, usage: { input: 0, output: 0 },
    messages: [], thread: { id: 'th' }, turn: { id: 'tu' },
    ...result,
  } as TurnResult;
  return new TurnOutput(stream, Promise.resolve(turnResult), () => {});
}

/** 读取 SSE Response，解析出 UIMessageChunk 数组 */
async function readChunks(res: Response): Promise<UIMessageChunk[]> {
  const text = await res.text();
  return text.split('\n\n').filter(Boolean)
    .map((l) => l.replace(/^data: /, ''))
    .filter((l) => l !== '[DONE]')
    .map((l) => JSON.parse(l) as UIMessageChunk);
}

describe('turnOutputToSSEResponse', () => {
  it('文本流映射为 start/start-step/text-*/finish-step/finish', async () => {
    const res = turnOutputToSSEResponse(makeOutput([
      { type: 'text-start', id: 't1' },
      { type: 'text-delta', id: 't1', delta: 'hi' },
      { type: 'text-end', id: 't1' },
      { type: 'finish', usage: { inputTokens: { total: 3, noCache: 3, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 2, text: 2, reasoning: 0 } }, finishReason: { unified: 'stop', raw: 'stop' } },
    ]));
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const chunks = await readChunks(res);
    const types = chunks.map((c) => c.type);
    expect(types).toEqual(['start', 'start-step', 'text-start', 'text-delta', 'text-end', 'finish-step', 'finish']);
    const finish = chunks.at(-1) as Extract<UIMessageChunk, { type: 'finish' }>;
    expect(finish.finishReason).toBe('stop');
    // usage 经 asLanguageModelUsage 扁平化后挂在 messageMetadata.custom.usage
    expect((finish.messageMetadata as { custom: { usage: { inputTokens: number } } }).custom.usage.inputTokens).toBe(3);
  });

  it('tool-call 映射 tool-input-available 且 input 已解析；tool-result 映射 tool-output-available', async () => {
    const chunks = await readChunks(turnOutputToSSEResponse(makeOutput([
      { type: 'tool-input-start', id: 'c1', toolName: 'echo' },
      { type: 'tool-input-delta', id: 'c1', delta: '{"x":1}' },
      { type: 'tool-call', toolCallId: 'c1', toolName: 'echo', input: '{"x":1}' },
      { type: 'tool-result', toolCallId: 'c1', toolName: 'echo', result: 'ok' },
    ])));
    expect(chunks).toContainEqual({ type: 'tool-input-start', toolCallId: 'c1', toolName: 'echo' });
    expect(chunks).toContainEqual({ type: 'tool-input-delta', toolCallId: 'c1', inputTextDelta: '{"x":1}' });
    expect(chunks).toContainEqual({ type: 'tool-input-available', toolCallId: 'c1', toolName: 'echo', input: { x: 1 } });
    expect(chunks).toContainEqual({ type: 'tool-output-available', toolCallId: 'c1', output: 'ok' });
  });

  it('paused 结果发出 data-turn-paused，审批请求透传', async () => {
    const chunks = await readChunks(turnOutputToSSEResponse(makeOutput(
      [{ type: 'tool-approval-request', approvalId: 'c1', toolCallId: 'c1' }],
      { status: 'paused' },
    )));
    expect(chunks).toContainEqual({ type: 'tool-approval-request', approvalId: 'c1', toolCallId: 'c1' });
    expect(chunks.some((c) => c.type === 'data-turn-paused')).toBe(true);
  });

  it('custom 与 reasoning-file 走原生 UI chunk', async () => {
    const chunks = await readChunks(turnOutputToSSEResponse(makeOutput([
      { type: 'custom', kind: 'openai.annotation' },
      { type: 'reasoning-file', mediaType: 'image/png', data: { type: 'url', url: new URL('https://x.test/a.png') } },
    ])));
    expect(chunks).toContainEqual({ type: 'custom', kind: 'openai.annotation' });
    expect(chunks).toContainEqual({ type: 'reasoning-file', url: 'https://x.test/a.png', mediaType: 'image/png' });
  });
});
