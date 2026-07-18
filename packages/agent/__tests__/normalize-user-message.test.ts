// packages/agent/__tests__/normalize-user-message.test.ts
import { describe, it, expect } from 'vitest';
import type { ModelMessage, UIMessage } from 'ai';
import { normalizeUserMessage } from '../src/agent-loop/utils.js';
import { pickPrimaryUserMessage } from '../src/model/message-utils.js';

describe('normalizeUserMessage', () => {
  it('string → 单条 user 消息', async () => {
    expect(await normalizeUserMessage('hi')).toEqual([{ role: 'user', content: 'hi' }]);
  });

  it('ModelMessage[] → 原样透传全部', async () => {
    const messages: ModelMessage[] = [
      { role: 'system', content: 'few-shot 示例' },
      { role: 'user', content: '问题 A' },
      { role: 'assistant', content: '答案 A' },
      { role: 'user', content: '正式问题' },
    ];
    expect(await normalizeUserMessage(messages)).toBe(messages);
  });

  it('UIMessage[] → 校验转换后取最后一条', async () => {
    const uiMessages: UIMessage[] = [
      { id: 'm1', role: 'user', parts: [{ type: 'text', text: '历史问题' }] },
      { id: 'm2', role: 'assistant', parts: [{ type: 'text', text: '历史回答' }] },
      { id: 'm3', role: 'user', parts: [{ type: 'text', text: '本轮问题' }] },
    ];
    const result = await normalizeUserMessage(uiMessages);
    expect(result).toHaveLength(1);
    expect(result[0].role).toBe('user');
    expect(result[0].content).toEqual([{ type: 'text', text: '本轮问题' }]);
  });

  it('空数组 → 兜底单条空 user 消息', async () => {
    expect(await normalizeUserMessage([])).toEqual([{ role: 'user', content: '' }]);
  });
});

describe('pickPrimaryUserMessage', () => {
  it('取最后一条 user 角色消息', () => {
    const messages: ModelMessage[] = [
      { role: 'user', content: '第一条' },
      { role: 'assistant', content: '回答' },
      { role: 'user', content: '最后一条' },
    ];
    expect(pickPrimaryUserMessage(messages)).toEqual({ role: 'user', content: '最后一条' });
  });

  it('无 user 角色时取末条', () => {
    const messages: ModelMessage[] = [{ role: 'system', content: 's' }, { role: 'assistant', content: 'a' }];
    expect(pickPrimaryUserMessage(messages)).toEqual({ role: 'assistant', content: 'a' });
  });

  it('空数组返回 undefined', () => {
    expect(pickPrimaryUserMessage([])).toBeUndefined();
  });
});
