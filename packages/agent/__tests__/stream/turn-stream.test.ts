// packages/agent/__tests__/stream/turn-stream.test.ts
import { describe, it, expect } from 'vitest';
import type { UIMessageChunk } from 'ai';
import { TurnOutput } from '../../src/agent-loop/turn-output.js';
import { turnOutputToSSEResponse } from '../../src/stream/turn-stream.js';
import type { TurnResult } from '../../src/agent-loop/agent-loop-options.js';
import {
  type AgentStreamPart,
  finishStepPart,
  startStepPart,
  toolApprovalRequestPart,
  toolCallPart,
  toolOutputDeniedPart,
  toolResultPart,
  v4FilePart,
} from '../../src/agent-loop/stream-parts.js';

function makeOutput(parts: AgentStreamPart[], result: Partial<TurnResult> = {}): TurnOutput {
  const stream = new ReadableStream<AgentStreamPart>({
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
  it('文本流映射为 start/start-step/text-*/message-metadata/finish-step/finish', async () => {
    const res = turnOutputToSSEResponse(makeOutput([
      startStepPart([]),
      { type: 'text-start', id: 't1' },
      { type: 'text-delta', id: 't1', text: 'hi' },
      { type: 'text-end', id: 't1' },
      finishStepPart({
        usage: { inputTokens: { total: 3, noCache: 3, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 2, text: 2, reasoning: 0 } },
        finishReason: { unified: 'stop', raw: 'stop' },
        response: {},
        startTime: Date.now(),
      }),
      { type: 'finish', finishReason: 'stop', rawFinishReason: undefined, totalUsage: { inputTokens: 3, inputTokenDetails: { noCacheTokens: undefined, cacheReadTokens: undefined, cacheWriteTokens: undefined }, outputTokens: 2, outputTokenDetails: { textTokens: undefined, reasoningTokens: undefined }, totalTokens: 5 } },
    ]));
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const chunks = await readChunks(res);
    const types = chunks.map((c) => c.type);
    expect(types).toEqual(['start', 'start-step', 'text-start', 'text-delta', 'text-end', 'message-metadata', 'finish-step', 'finish']);
    expect(chunks).toContainEqual(expect.objectContaining({ type: 'text-delta', id: 't1', delta: 'hi' }));
    const finish = chunks.at(-1) as Extract<UIMessageChunk, { type: 'finish' }>;
    expect(finish.finishReason).toBe('stop');
    // usage 由引擎 finish-step 携带（已扁平化），挂在 messageMetadata.custom.usage
    expect((finish.messageMetadata as { custom: { usage: { inputTokens: number } } }).custom.usage.inputTokens).toBe(3);
  });

  it('tool-call 映射 tool-input-available（input 已解析）；tool-result 映射 tool-output-available', async () => {
    const chunks = await readChunks(turnOutputToSSEResponse(makeOutput([
      { type: 'tool-input-start', id: 'c1', toolName: 'echo' },
      { type: 'tool-input-delta', id: 'c1', delta: '{"x":1}' },
      toolCallPart({ id: 'c1', name: 'echo', args: { x: 1 } }),
      toolResultPart({ callId: 'c1', name: 'echo', status: 'success', output: 'ok' }, { x: 1 }),
    ])));
    expect(chunks).toContainEqual({ type: 'tool-input-start', toolCallId: 'c1', toolName: 'echo' });
    expect(chunks).toContainEqual({ type: 'tool-input-delta', toolCallId: 'c1', inputTextDelta: '{"x":1}' });
    expect(chunks).toContainEqual({ type: 'tool-input-available', toolCallId: 'c1', toolName: 'echo', input: { x: 1 }, dynamic: true });
    expect(chunks).toContainEqual({ type: 'tool-output-available', toolCallId: 'c1', output: 'ok', dynamic: true });
  });

  it('tool-error 映射 tool-output-error，tool-output-denied 透传', async () => {
    const chunks = await readChunks(turnOutputToSSEResponse(makeOutput([
      toolResultPart({ callId: 'c1', name: 'echo', status: 'error', output: null, error: 'boom' }, {}),
      toolOutputDeniedPart({ id: 'c2', name: 'rm', args: {} }),
    ])));
    expect(chunks).toContainEqual({ type: 'tool-output-error', toolCallId: 'c1', errorText: 'boom', dynamic: true });
    expect(chunks).toContainEqual({ type: 'tool-output-denied', toolCallId: 'c2' });
  });

  it('paused 结果发出 data-turn-paused，审批请求映射 approvalId + toolCallId', async () => {
    const chunks = await readChunks(turnOutputToSSEResponse(makeOutput(
      [toolApprovalRequestPart({ id: 'c1', name: 'rm', args: {} })],
      { status: 'paused' },
    )));
    expect(chunks).toContainEqual({ type: 'tool-approval-request', approvalId: 'c1', toolCallId: 'c1' });
    expect(chunks.some((c) => c.type === 'data-turn-paused')).toBe(true);
  });

  it('custom 与 reasoning-file 走原生 UI chunk', async () => {
    const chunks = await readChunks(turnOutputToSSEResponse(makeOutput([
      { type: 'custom', kind: 'openai.annotation' },
      v4FilePart({ type: 'reasoning-file', mediaType: 'image/png', data: { type: 'url', url: new URL('https://x.test/a.png') } }),
    ])));
    expect(chunks).toContainEqual({ type: 'custom', kind: 'openai.annotation' });
    expect(chunks).toContainEqual({ type: 'reasoning-file', url: 'https://x.test/a.png', mediaType: 'image/png' });
  });

  it('abort 由 result.status 判定写出', async () => {
    const chunks = await readChunks(turnOutputToSSEResponse(makeOutput(
      [{ type: 'abort' }],
      { status: 'aborted' },
    )));
    // 引擎 abort part 跳过，仅按 result.status 写出一次
    expect(chunks.filter((c) => c.type === 'abort')).toHaveLength(1);
  });
});
