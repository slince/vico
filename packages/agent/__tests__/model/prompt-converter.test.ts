import { describe, it, expect } from 'vitest';
import { convertToPrompt } from '../../src/model/prompt-converter.js';
import type { ModelMessage } from '../../src/model/types.js';

describe('convertToPrompt', () => {
  it('converts system option to system message', () => {
    const prompt = convertToPrompt([], 'You are helpful');
    expect(prompt).toEqual([
      { role: 'system', content: 'You are helpful' },
    ]);
  });

  it('omits system message when system is undefined', () => {
    const prompt = convertToPrompt([], undefined);
    expect(prompt).toEqual([]);
  });

  it('converts user message with text content', () => {
    const messages: ModelMessage[] = [{ role: 'user', content: 'Hello' }];
    const prompt = convertToPrompt(messages);
    expect(prompt).toEqual([
      { role: 'user', content: [{ type: 'text', text: 'Hello' }] },
    ]);
  });

  it('converts assistant message with text', () => {
    const messages: ModelMessage[] = [{ role: 'assistant', content: 'Hi there' }];
    const prompt = convertToPrompt(messages);
    expect(prompt).toEqual([
      { role: 'assistant', content: [{ type: 'text', text: 'Hi there' }] },
    ]);
  });

  it('converts assistant message with tool calls', () => {
    const messages: ModelMessage[] = [{
      role: 'assistant',
      content: 'Let me check',
      toolCalls: [{ id: 'tc1', name: 'search', args: { q: 'hello' } }],
    }];
    const prompt = convertToPrompt(messages);
    expect(prompt).toEqual([{
      role: 'assistant',
      content: [
        { type: 'text', text: 'Let me check' },
        { type: 'tool-call', toolCallId: 'tc1', toolName: 'search', input: { q: 'hello' } },
      ],
    }]);
  });

  it('converts assistant message with only tool calls (no text)', () => {
    const messages: ModelMessage[] = [{
      role: 'assistant',
      content: '',
      toolCalls: [{ id: 'tc1', name: 'search', args: {} }],
    }];
    const prompt = convertToPrompt(messages);
    expect(prompt).toEqual([{
      role: 'assistant',
      content: [
        { type: 'tool-call', toolCallId: 'tc1', toolName: 'search', input: {} },
      ],
    }]);
  });

  it('converts tool message', () => {
    const messages: ModelMessage[] = [{
      role: 'tool',
      content: 'result text',
      toolCallId: 'tc1',
    }];
    const prompt = convertToPrompt(messages);
    expect(prompt).toEqual([{
      role: 'tool',
      content: [{
        type: 'tool-result',
        toolCallId: 'tc1',
        toolName: '',
        output: { type: 'text', value: 'result text' },
      }],
    }]);
  });

  it('converts mixed conversation', () => {
    const messages: ModelMessage[] = [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi!', toolCalls: [{ id: 'tc1', name: 'greet', args: {} }] },
      { role: 'tool', content: 'ok', toolCallId: 'tc1' },
      { role: 'assistant', content: 'Done' },
    ];
    const prompt = convertToPrompt(messages, 'Be helpful');
    expect(prompt).toHaveLength(5); // system + 4 messages
    expect(prompt[0]).toEqual({ role: 'system', content: 'Be helpful' });
    expect(prompt[1].role).toBe('user');
    expect(prompt[2].role).toBe('assistant');
    expect(prompt[3].role).toBe('tool');
    expect(prompt[4].role).toBe('assistant');
  });
});
