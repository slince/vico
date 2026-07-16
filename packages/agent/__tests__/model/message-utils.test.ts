// packages/agent/__tests__/model/message-utils.test.ts
import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import type { ModelMessage } from 'ai';
import {
  getMessageText, getToolCalls, hasToolResult, getToolResultText,
  buildAssistantMessage, buildToolResultMessage, modelMessageToUIMessage, toToolSet,
} from '../../src/model/message-utils.js';
import { createTool } from '../../src/tool/create-tool.js';

describe('message-utils', () => {
  it('getMessageText 支持 string 和 parts 两种 content', () => {
    expect(getMessageText({ role: 'user', content: 'hi' })).toBe('hi');
    expect(getMessageText({
      role: 'assistant',
      content: [{ type: 'text', text: 'a' }, { type: 'tool-call', toolCallId: '1', toolName: 't', input: {} }, { type: 'text', text: 'b' }],
    })).toBe('ab');
  });

  it('getToolCalls 从 assistant parts 提取 Vico ToolCall', () => {
    const msg: ModelMessage = {
      role: 'assistant',
      content: [{ type: 'tool-call', toolCallId: 'c1', toolName: 'echo', input: { x: 1 } }],
    };
    expect(getToolCalls(msg)).toEqual([{ id: 'c1', name: 'echo', args: { x: 1 } }]);
    expect(getToolCalls({ role: 'user', content: 'hi' })).toEqual([]);
  });

  it('buildAssistantMessage 组装 text + tool-call parts，空内容兜底空文本', () => {
    const msg = buildAssistantMessage('hello', [{ id: 'c1', name: 'echo', args: { x: 1 } }]);
    expect(msg).toEqual({
      role: 'assistant',
      content: [
        { type: 'text', text: 'hello' },
        { type: 'tool-call', toolCallId: 'c1', toolName: 'echo', input: { x: 1 } },
      ],
    });
    expect(buildAssistantMessage('', [])).toEqual({ role: 'assistant', content: [{ type: 'text', text: '' }] });
  });

  it('buildToolResultMessage 按成功/失败生成 text/error-text output', () => {
    const ok = buildToolResultMessage({ callId: 'c1', name: 'echo', status: 'success', output: 'r' }, 'r');
    expect(ok).toEqual({
      role: 'tool',
      content: [{ type: 'tool-result', toolCallId: 'c1', toolName: 'echo', output: { type: 'text', value: 'r' } }],
    });
    const err = buildToolResultMessage({ callId: 'c2', name: 'echo', status: 'error', output: null, error: 'boom' }, 'boom');
    expect((err.content[0] as { output: { type: string } }).output.type).toBe('error-text');
  });

  it('hasToolResult / getToolResultText 在消息链中查找工具结果', () => {
    const messages: ModelMessage[] = [
      { role: 'user', content: 'q' },
      buildToolResultMessage({ callId: 'c1', name: 'echo', status: 'success', output: 'ok' }, 'ok'),
    ];
    expect(hasToolResult(messages, 'c1')).toBe(true);
    expect(hasToolResult(messages, 'c2')).toBe(false);
    expect(getToolResultText(messages, 'c1')).toBe('ok');
    expect(getToolResultText(messages, 'c2')).toBeUndefined();
  });

  it('modelMessageToUIMessage 只转换有文本的非 tool 消息', () => {
    expect(modelMessageToUIMessage({ role: 'user', content: 'hi' }, 'm1')).toEqual({
      id: 'm1', role: 'user', parts: [{ type: 'text', text: 'hi' }],
    });
    expect(modelMessageToUIMessage(buildToolResultMessage({ callId: 'c', name: 'n', status: 'success', output: 1 }, '1'), 'm2')).toBeUndefined();
  });

  it('toToolSet 将 Vico Tool 转为 ai ToolSet', () => {
    const echo = createTool({
      name: 'echo', description: 'Echo', inputSchema: z.object({ message: z.string() }),
      execute: async (args) => args.message,
    });
    const set = toToolSet([echo]);
    expect(Object.keys(set)).toEqual(['echo']);
    expect(set.echo.description).toBe('Echo');
  });
});
