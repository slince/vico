import { describe, expect, it } from 'vitest';
import type { ModelMessage, ToolCallPart, ToolResultPart } from 'ai';
import { findUnpairedToolCalls } from './loop-agent.js';
import { KeyedMutex } from '../utils/async-keyed-lock.js';

const toolCallMsg = (calls: { id: string; name: string }[]): ModelMessage => ({
  role: 'assistant',
  content: calls.map((c): ToolCallPart => ({ type: 'tool-call', toolCallId: c.id, toolName: c.name, input: {} })),
});

const toolResultMsg = (ids: string[]): ModelMessage => ({
  role: 'tool',
  content: ids.map((id): ToolResultPart => ({ type: 'tool-result', toolCallId: id, toolName: 't', output: { type: 'text', value: 'ok' } })),
});

describe('findUnpairedToolCalls（消息链核对）', () => {
  it('全部配对 → null（step 已完成，不重发）', () => {
    const messages: ModelMessage[] = [toolCallMsg([{ id: 'c1', name: 't' }]), toolResultMsg(['c1'])];
    expect(findUnpairedToolCalls(messages)).toBeNull();
  });

  it('最后一条 assistant 含未配对调用 → 返回其索引与 id（重新决策）', () => {
    const messages: ModelMessage[] = [
      toolCallMsg([{ id: 'c1', name: 't' }]),
      toolResultMsg(['c1']),
      toolCallMsg([{ id: 'c2', name: 't' }, { id: 'c3', name: 'u' }]),
      toolResultMsg(['c2']), // c3 未配对
    ];
    const unpaired = findUnpairedToolCalls(messages);
    expect(unpaired).toEqual({ assistantIndex: 2, unpairedCallIds: ['c3'] });
  });

  it('无 assistant tool-call 消息 → null', () => {
    const messages: ModelMessage[] = [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }];
    expect(findUnpairedToolCalls(messages)).toBeNull();
  });
});

describe('KeyedMutex（per-turn 执行锁，防线①）', () => {
  it('同一 key 的任务严格串行', async () => {
    const mutex = new KeyedMutex();
    const order: number[] = [];
    const tasks = [0, 1, 2].map((i) => mutex.run('turn-1', async () => {
      order.push(i);
      await new Promise((r) => setTimeout(r, 5));
      order.push(i);
    }));
    await Promise.all(tasks);
    expect(order).toEqual([0, 0, 1, 1, 2, 2]);
  });

  it('前一个任务失败不阻塞后续排队任务', async () => {
    const mutex = new KeyedMutex();
    const results: string[] = [];
    await Promise.all([
      mutex.run('turn-1', async () => { throw new Error('boom'); }).catch(() => results.push('fail')),
      mutex.run('turn-1', async () => results.push('ok')),
    ]);
    expect(results).toEqual(['fail', 'ok']);
  });
});
