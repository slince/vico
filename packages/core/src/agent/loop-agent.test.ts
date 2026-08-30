import { describe, expect, it } from 'vitest';
import type { ModelMessage } from 'ai';
import { findUnpairedToolCalls } from './loop-agent.js';

const toolCallMsg = (calls: { id: string; name: string }[]): ModelMessage => ({
  role: 'assistant',
  content: calls.map((c) => ({ type: 'tool-call' as const, toolCallId: c.id, toolName: c.name, args: {} })),
});

const toolResultMsg = (ids: string[]): ModelMessage => ({
  role: 'tool',
  content: ids.map((id) => ({ type: 'tool-result' as const, toolCallId: id, toolResult: { type: 'text' as const, text: 'ok' } })),
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
