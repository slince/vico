// @vico/agent - 将内部 ModelMessage[] 转换为 LanguageModelV3Prompt
import type {
  LanguageModelV3Prompt,
  LanguageModelV3Message,
  LanguageModelV3TextPart,
  LanguageModelV3ToolCallPart,
  LanguageModelV3ToolResultPart,
} from '@ai-sdk/provider';
import type { ModelMessage } from './types.js';

/**
 * 将 Vico 的 ModelMessage[] 转换为 provider 层的 LanguageModelV3Prompt。
 * system 提示词作为第一条消息单独传入。
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
      } as LanguageModelV3Message;

    case 'assistant': {
      const parts: Array<LanguageModelV3TextPart | LanguageModelV3ToolCallPart | LanguageModelV3ToolResultPart> = [];
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
      // content 数组不能为空
      if (parts.length === 0) {
        parts.push({ type: 'text', text: '' });
      }
      return { role: 'assistant', content: parts } as LanguageModelV3Message;
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
      } as LanguageModelV3Message;

    default:
      // 历史中的 system 消息按 user 处理（通常不应出现）
      return {
        role: 'user',
        content: [{ type: 'text', text: msg.content }],
      } as LanguageModelV3Message;
  }
}
