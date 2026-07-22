// packages/core/__tests__/normalize-user-message.test.ts
import { describe, it, expect } from 'vitest';
import type { ModelMessage, UIMessage } from 'ai';
import { normalizeUserMessage, extractApprovalDecisions } from '../src/agent-loop/utils.js';
import { pickPrimaryUserMessage, extractApprovalResponses, buildApprovalResponseMessage } from '../src/model/message-utils.js';

/** 构造携带 Vico 扩展审批 part 的 user 消息（模拟客户端审批响应） */
function approvalUIMessage(id: string, decisions: Array<{ approvalId: string; approved: boolean }>, text?: string): UIMessage {
  const parts = decisions.map((d) => ({ type: 'tool-approval-response', ...d }));
  if (text) parts.unshift({ type: 'text', text } as never);
  return { id, role: 'user', parts: parts as UIMessage['parts'] };
}

describe('normalizeUserMessage', () => {
  it('string → 单条 user 消息', async () => {
    expect(await normalizeUserMessage('hi')).toEqual([{ role: 'user', content: 'hi' }]);
  });

  it('空串 / 空数组 → 空消息组（不注入空消息）', async () => {
    expect(await normalizeUserMessage('')).toEqual([]);
    expect(await normalizeUserMessage([])).toEqual([]);
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
    const messages = await normalizeUserMessage(uiMessages);
    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe('user');
    expect(messages[0].content).toEqual([{ type: 'text', text: '本轮问题' }]);
  });

  it('审批-only UIMessage → 仅返回合成的原生审批 tool 消息', async () => {
    const messages = await normalizeUserMessage([
      approvalUIMessage('m1', [{ approvalId: 'c1', approved: true }, { approvalId: 'c2', approved: false }]),
    ]);
    expect(messages).toEqual([{
      role: 'tool',
      content: [
        { type: 'tool-approval-response', approvalId: 'c1', approved: true },
        { type: 'tool-approval-response', approvalId: 'c2', approved: false },
      ],
    }]);
  });

  it('文本 + 审批混合 UIMessage → 审批消息在前，剥离审批 part 后的文本消息在后', async () => {
    const messages = await normalizeUserMessage([
      approvalUIMessage('m1', [{ approvalId: 'c1', approved: true }], '继续执行'),
    ]);
    expect(messages).toHaveLength(2);
    expect(messages[0]).toEqual({
      role: 'tool',
      content: [{ type: 'tool-approval-response', approvalId: 'c1', approved: true }],
    });
    expect(messages[1].role).toBe('user');
    expect(messages[1].content).toEqual([{ type: 'text', text: '继续执行' }]);
  });
});

describe('extractApprovalDecisions', () => {
  it('扩展 part：approvalId 映射 toolCallId，缺省 approved 视为拒绝', () => {
    const messages: UIMessage[] = [
      { id: 'm1', role: 'user', parts: [{ type: 'tool-approval-response', approvalId: 'c1' }] as never },
    ];
    expect(extractApprovalDecisions(messages)).toEqual([{ toolCallId: 'c1', approved: false }]);
  });

  it('同一 toolCallId 后出现的决策覆盖先前的', () => {
    const messages: UIMessage[] = [
      approvalUIMessage('m1', [{ approvalId: 'c1', approved: false }]),
      approvalUIMessage('m2', [{ approvalId: 'c1', approved: true }]),
    ];
    expect(extractApprovalDecisions(messages)).toEqual([{ toolCallId: 'c1', approved: true }]);
  });

  it('无审批 part 返回 undefined', () => {
    expect(extractApprovalDecisions([{ id: 'm1', role: 'user', parts: [{ type: 'text', text: 'hi' }] }])).toBeUndefined();
  });
});

describe('extractApprovalResponses（原生 in-band 审批解析）', () => {
  it('解析审批决策并剔除审批消息，其余消息原样保留', () => {
    const approvalMsg = buildApprovalResponseMessage([
      { toolCallId: 'c1', approved: true },
      { toolCallId: 'c2', approved: false },
    ]);
    const userMsg: ModelMessage = { role: 'user', content: '继续' };
    const { decisions, rest } = extractApprovalResponses([approvalMsg, userMsg]);
    expect(decisions).toEqual([
      { toolCallId: 'c1', approved: true },
      { toolCallId: 'c2', approved: false },
    ]);
    expect(rest).toEqual([userMsg]);
  });

  it('消息中混有 tool-result part 时仅剔除审批 part，不限 role', () => {
    const mixed: ModelMessage = {
      role: 'tool',
      content: [
        { type: 'tool-approval-response', approvalId: 'c1', approved: true },
        { type: 'tool-result', toolCallId: 'c0', toolName: 'echo', output: { type: 'text', value: 'ok' } },
      ] as never,
    };
    const { decisions, rest } = extractApprovalResponses([mixed]);
    expect(decisions).toEqual([{ toolCallId: 'c1', approved: true }]);
    expect(rest).toEqual([{
      role: 'tool',
      content: [{ type: 'tool-result', toolCallId: 'c0', toolName: 'echo', output: { type: 'text', value: 'ok' } }],
    }]);
  });

  it('同一 toolCallId 后出现的决策覆盖先前的', () => {
    const { decisions } = extractApprovalResponses([
      buildApprovalResponseMessage([{ toolCallId: 'c1', approved: false }]),
      buildApprovalResponseMessage([{ toolCallId: 'c1', approved: true }]),
    ]);
    expect(decisions).toEqual([{ toolCallId: 'c1', approved: true }]);
  });

  it('无审批 part 时 decisions 为空，消息原样返回', () => {
    const messages: ModelMessage[] = [{ role: 'user', content: 'hi' }];
    const { decisions, rest } = extractApprovalResponses(messages);
    expect(decisions).toEqual([]);
    expect(rest).toEqual(messages);
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
