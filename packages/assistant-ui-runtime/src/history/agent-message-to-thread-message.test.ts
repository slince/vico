import {describe, expect, it} from 'vitest';
import type {AgentMessage} from '@vico/model';
import {agentMessagesToThreadMessages} from './agent-message-to-thread-message.js';

/** 构造一条消息（usage 走 as 断言，测试只关心内容） */
function msg(partial: Record<string, unknown>): AgentMessage {
  return partial as unknown as AgentMessage;
}

describe('agentMessagesToThreadMessages', () => {
  it('user 消息沿用 AgentMessage 的 id，文本落到 text part', () => {
    const [user] = agentMessagesToThreadMessages([
      msg({id: 'm1', role: 'user', content: [{type: 'text', text: '你好'}]}),
    ]);
    expect(user?.id).toBe('m1');
    expect(user?.role).toBe('user');
    expect(user?.content).toEqual([{type: 'text', text: '你好'}]);
  });

  it('assistant 的 reasoning/text/tool-call 各自成 part，argsText 为入参 JSON', () => {
    const [assistant] = agentMessagesToThreadMessages([
      msg({
        id: 'm2',
        role: 'assistant',
        content: [
          {type: 'reasoning', text: '想一想'},
          {type: 'text', text: '我查一下'},
          {type: 'tool-call', toolCallId: 'c1', toolName: 'weather', input: {city: '南京'}},
        ],
      }),
    ]);
    expect(assistant?.role).toBe('assistant');
    const content = assistant?.content as unknown as Array<Record<string, unknown>>;
    expect(content.map((p) => p.type)).toEqual(['reasoning', 'text', 'tool-call']);
    expect(content[2]).toMatchObject({
      toolCallId: 'c1',
      toolName: 'weather',
      argsText: '{"city":"南京"}',
      args: {city: '南京'},
    });
  });

  it('tool 消息的 tool-result 合回对应 tool-call part', () => {
    const messages = agentMessagesToThreadMessages([
      msg({
        id: 'm3',
        role: 'assistant',
        content: [{type: 'tool-call', toolCallId: 'c1', toolName: 'weather', input: {}}],
      }),
      msg({
        id: 'm4',
        role: 'tool',
        content: [{type: 'tool-result', toolCallId: 'c1', toolName: 'weather', output: {type: 'json', value: {temp: 12}}}],
      }),
    ]);
    expect(messages).toHaveLength(1);
    const part = (messages[0]?.content as unknown as Array<Record<string, unknown>>)[0];
    expect(part?.result).toEqual({temp: 12});
    expect(messages[0]?.status).toEqual({type: 'complete', reason: 'stop'});
  });

  it('tool-result 为 error-text 时标 isError', () => {
    const messages = agentMessagesToThreadMessages([
      msg({
        id: 'm5',
        role: 'assistant',
        content: [{type: 'tool-call', toolCallId: 'c1', toolName: 'x', input: {}}],
      }),
      msg({
        id: 'm6',
        role: 'tool',
        content: [{type: 'tool-result', toolCallId: 'c1', toolName: 'x', output: {type: 'error-text', value: 'boom'}}],
      }),
    ]);
    const part = (messages[0]?.content as unknown as Array<Record<string, unknown>>)[0];
    expect(part).toMatchObject({result: 'boom', isError: true});
  });

  it('待审批且未落结果的调用还原为 requires-action', () => {
    const [assistant] = agentMessagesToThreadMessages([
      msg({
        id: 'm7',
        role: 'assistant',
        content: [
          {type: 'tool-call', toolCallId: 'c1', toolName: 'shell', input: {cmd: 'ls'}},
          {type: 'tool-approval-request', approvalId: 'c1', toolCallId: 'c1'},
        ],
      }),
    ]);
    expect(assistant?.status).toEqual({type: 'requires-action', reason: 'tool-calls'});
    const part = (assistant?.content as unknown as Array<Record<string, unknown>>)[0];
    expect(part?.approval).toEqual({id: 'c1', prompt: 'Approve tool "shell"?'});
  });

  it('已有 tool-result 的调用不再还原审批态', () => {
    const messages = agentMessagesToThreadMessages([
      msg({
        id: 'm8',
        role: 'assistant',
        content: [
          {type: 'tool-call', toolCallId: 'c1', toolName: 'shell', input: {}},
          {type: 'tool-approval-request', approvalId: 'c1', toolCallId: 'c1'},
        ],
      }),
      msg({id: 'm9', role: 'tool', content: [{type: 'tool-result', toolCallId: 'c1', toolName: 'shell', output: {type: 'text', value: 'ok'}}]}),
    ]);
    expect(messages[0]?.status).toEqual({type: 'complete', reason: 'stop'});
    const part = (messages[0]?.content as unknown as Array<Record<string, unknown>>)[0];
    expect(part?.approval).toBeUndefined();
  });

  it('usage 映射为 step 用量，turnId 透传到 metadata.custom', () => {
    const [assistant] = agentMessagesToThreadMessages([
      msg({
        id: 'm10',
        role: 'assistant',
        turnId: 'turn-1',
        content: [{type: 'text', text: 'hi'}],
        usage: {
          inputTokens: {total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0},
          outputTokens: {total: 5, text: 5, reasoning: 0},
        },
      }),
    ]);
    const metadata = assistant?.metadata as unknown as Record<string, unknown>;
    expect(metadata.steps).toEqual([{usage: {inputTokens: 10, outputTokens: 5}}]);
    expect(metadata.custom).toEqual({turnId: 'turn-1'});
  });

  it('system 消息映射为 system 角色', () => {
    const [system] = agentMessagesToThreadMessages([
      msg({id: 'm11', role: 'system', content: '压缩摘要'}),
    ]);
    expect(system?.role).toBe('system');
    expect(system?.content).toEqual([{type: 'text', text: '压缩摘要'}]);
  });
});
