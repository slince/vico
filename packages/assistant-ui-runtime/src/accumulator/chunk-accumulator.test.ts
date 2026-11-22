import type {ThreadAssistantMessagePart} from '@assistant-ui/react';
import {describe, expect, it} from 'vitest';
import type {ChunkType} from '@vico/stream';
import {ChunkAccumulator} from './chunk-accumulator.js';

const RUN = 'run-1';

/** 构造带信封的 chunk（丢弃字面量类型，测试里只需要塞数据） */
function chunk(type: ChunkType['type'], payload: unknown): ChunkType {
  return {type, runId: RUN, payload} as ChunkType;
}

/** 取第 index 个文本 part，顺便做类型收窄 */
function textPart(content: readonly ThreadAssistantMessagePart[], index = 0) {
  const part = content[index];
  if (!part || part.type !== 'text') throw new Error(`part[${index}] is not text`);
  return part;
}

/** 取第 index 个推理 part */
function reasoningPart(content: readonly ThreadAssistantMessagePart[], index = 0) {
  const part = content[index];
  if (!part || part.type !== 'reasoning') throw new Error(`part[${index}] is not reasoning`);
  return part;
}

/** 取第 index 个 tool-call part */
function toolPart(content: readonly ThreadAssistantMessagePart[], index = 0) {
  const part = content[index];
  if (!part || part.type !== 'tool-call') throw new Error(`part[${index}] is not tool-call`);
  return part;
}

/** 断言用的部件摘要 */
function summarize(content: readonly ThreadAssistantMessagePart[]) {
  return content.map((part) => {
    if (part.type === 'text') return {type: 'text', text: part.text};
    if (part.type === 'reasoning') return {type: 'reasoning', text: part.text};
    if (part.type !== 'tool-call') return {type: part.type};
    return {
      type: 'tool-call',
      toolCallId: part.toolCallId,
      toolName: part.toolName,
      argsText: part.argsText,
      args: part.args,
      result: part.result,
      isError: part.isError,
      approvalId: part.approval?.id,
    };
  });
}

describe('ChunkAccumulator', () => {
  it('文本/推理按 id 归并，块结束后 part 状态为 complete', () => {
    const acc = new ChunkAccumulator();
    acc.push(chunk('start', {turnId: 'turn-1'}));
    acc.push(chunk('text-start', {id: 't1'}));
    acc.push(chunk('text-delta', {id: 't1', text: '你好'}));
    acc.push(chunk('text-delta', {id: 't1', text: '，南京'}));
    acc.push(chunk('reasoning-start', {id: 'r1'}));
    acc.push(chunk('reasoning-delta', {id: 'r1', text: '想想'}));

    const mid = acc.snapshot();
    expect(summarize(mid.content)).toEqual([
      {type: 'text', text: '你好，南京'},
      {type: 'reasoning', text: '想想'},
    ]);
    expect(textPart(mid.content).status).toEqual({type: 'running'});
    expect(reasoningPart(mid.content, 1).text).toBe('想想');

    acc.push(chunk('text-end', {id: 't1'}));
    expect(textPart(acc.snapshot().content).status).toEqual({type: 'complete'});
  });

  it('tool-input 流式入参逐步可解析，tool-call 到达后取最终入参', () => {
    const acc = new ChunkAccumulator();
    acc.push(chunk('tool-input-start', {toolCallId: 'c1', toolName: 'search'}));
    acc.push(chunk('tool-input-delta', {toolCallId: 'c1', delta: '{"query":'}));
    acc.push(chunk('tool-input-delta', {toolCallId: 'c1', delta: '"南京"}'}));
    acc.push(chunk('tool-input-end', {toolCallId: 'c1'}));

    const afterInput = toolPart(acc.snapshot().content);
    expect(afterInput.argsText).toBe('{"query":"南京"}');
    expect(afterInput.args).toEqual({query: '南京'});

    acc.push(chunk('tool-call', {toolCallId: 'c1', toolName: 'search', input: {query: '南京'}}));
    expect(toolPart(acc.snapshot().content).args).toEqual({query: '南京'});
  });

  it('只发汇总 tool-call（不发 tool-input-*）也能落到同一个 part', () => {
    const acc = new ChunkAccumulator();
    acc.push(chunk('tool-call', {toolCallId: 'c1', toolName: 'weather', input: {city: '南京'}}));
    acc.push(chunk('tool-result', {toolCallId: 'c1', toolName: 'weather', output: {temp: 12}}));
    const content = summarize(acc.snapshot().content);
    expect(content).toHaveLength(1);
    expect(content[0]).toMatchObject({argsText: '{"city":"南京"}', result: {temp: 12}});
  });

  it('tool-error 标记 isError 且 result 为错误文本', () => {
    const acc = new ChunkAccumulator();
    acc.push(chunk('tool-input-start', {toolCallId: 'c1', toolName: 'x'}));
    acc.push(chunk('tool-error', {toolCallId: 'c1', toolName: 'x', error: 'boom'}));
    const part = toolPart(acc.snapshot().content);
    expect(part.result).toBe('boom');
    expect(part.isError).toBe(true);
  });

  it('审批请求挂到 tool-call 上，finish 后停在 requires-action/tool-calls', () => {
    const acc = new ChunkAccumulator();
    acc.push(chunk('start', {turnId: 'turn-1'}));
    acc.push(chunk('start-step', {stepIndex: 0}));
    acc.push(chunk('tool-input-start', {toolCallId: 'c1', toolName: 'shell'}));
    acc.push(chunk('tool-call', {toolCallId: 'c1', toolName: 'shell', input: {cmd: 'ls'}}));
    acc.push(
      chunk('tool-approval-request', {
        approvalId: 'c1',
        toolCall: {toolCallId: 'c1', toolName: 'shell', input: {cmd: 'ls'}},
      }),
    );
    acc.push(
      chunk('finish-step', {
        stepIndex: 0,
        reason: 'pause',
        usage: {
          inputTokens: {total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0},
          outputTokens: {total: 5, text: 5, reasoning: 0},
        },
      }),
    );
    acc.push(
      chunk('finish', {
        finishReason: 'stop',
        totalUsage: {},
        usage: {
          inputTokens: {total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0},
          outputTokens: {total: 5, text: 5, reasoning: 0},
        },
      }),
    );

    const snapshot = acc.snapshot();
    expect(snapshot.status).toEqual({type: 'requires-action', reason: 'tool-calls'});
    const part = toolPart(snapshot.content);
    expect(part.approval?.id).toBe('c1');
    expect(part.approval?.prompt).toBe('Approve tool "shell"?');
    expect(part.approval?.approved).toBeUndefined();
    expect(snapshot.steps).toEqual([
      {messageId: 'turn-1', usage: {inputTokens: 10, outputTokens: 5}},
    ]);
  });

  it('没有待决议审批时 finish 收为 complete/stop', () => {
    const acc = new ChunkAccumulator();
    acc.push(chunk('start', {turnId: 'turn-1'}));
    acc.push(chunk('text-start', {id: 't1'}));
    acc.push(chunk('text-delta', {id: 't1', text: 'done'}));
    acc.push(
      chunk('finish', {
        finishReason: 'stop',
        totalUsage: {},
        usage: {
          inputTokens: {total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0},
          outputTokens: {total: 1, text: 1, reasoning: 0},
        },
      }),
    );
    expect(acc.snapshot().status).toEqual({type: 'complete', reason: 'stop'});
  });

  it('error / abort 映射到 incomplete 状态', () => {
    const errored = new ChunkAccumulator();
    errored.push(chunk('error', {error: 'API key missing'}));
    expect(errored.snapshot().status).toEqual({
      type: 'incomplete',
      reason: 'error',
      error: 'API key missing',
    });

    const aborted = new ChunkAccumulator();
    aborted.push(chunk('abort', {}));
    expect(aborted.snapshot().status).toEqual({type: 'incomplete', reason: 'cancelled'});
  });

  it('回放的 tool-approval-response 记在对应 part 上', () => {
    const acc = new ChunkAccumulator();
    acc.push(chunk('tool-call', {toolCallId: 'c1', toolName: 'shell', input: {cmd: 'ls'}}));
    acc.push(
      chunk('tool-approval-response', {
        approvalId: 'c1',
        toolCall: {toolCallId: 'c1', toolName: 'shell', input: {cmd: 'ls'}},
        approved: true,
      }),
    );
    expect(toolPart(acc.snapshot().content).approval?.approved).toBe(true);
    // 决议已回放 → 不再算待审批，finish 不该停住
    acc.push(
      chunk('finish', {
        finishReason: 'stop',
        totalUsage: {},
        usage: {
          inputTokens: {total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0},
          outputTokens: {total: 1, text: 1, reasoning: 0},
        },
      }),
    );
    expect(acc.snapshot().status).toEqual({type: 'complete', reason: 'stop'});
  });
});
