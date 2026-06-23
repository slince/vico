// @vico/agent - Convert internal ModelMessage[] to LanguageModelV3Prompt
import type { LanguageModelV3Prompt, LanguageModelV3Message } from '@ai-sdk/provider';
import type { ModelMessage } from './types.js';

/**
 * Convert Vico ModelMessage[] to provider-level LanguageModelV3Prompt.
 * System prompt is passed separately as the first message.
 */
export function convertToPrompt(messages: ModelMessage[], system?: string): LanguageModelV3Prompt {
  const prompt: LanguageModelV3Prompt = [];

  if (system) {
    prompt.push({ role: 'system', content: system });
  }

  for (const msg of messages) {
    prompt.push(convertMessage(msg));
  }

  return prompt;
}

function convertMessage(msg: ModelMessage): LanguageModelV3Message {
  switch (msg.role) {
    case 'user':
      return {
        role: 'user',
        content: [{ type: 'text', text: msg.content }],
      };

    case 'assistant': {
      const parts: LanguageModelV3Message['content'] = [];
      if (msg.content) {
        parts.push({ type: 'text', text: msg.content });
      }
      for (const tc of msg.toolCalls ?? []) {
        parts.push({
          type: 'tool-call',
          toolCallId: tc.id,
          toolName: tc.name,
          input: tc.args,
        });
      }
      // Content array must not be empty
      if (parts.length === 0) {
        parts.push({ type: 'text', text: '' });
      }
      return { role: 'assistant', content: parts };
    }

    case 'tool':
      return {
        role: 'tool',
        content: [{
          type: 'tool-result',
          toolCallId: msg.toolCallId!,
          toolName: '',
          output: { type: 'text', value: msg.content },
        }],
      };

    default:
      // system messages in history are treated as user (shouldn't normally happen)
      return {
        role: 'user',
        content: [{ type: 'text', text: msg.content }],
      };
  }
}
