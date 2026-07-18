// @vico/agent - 原生 ModelMessage 工具函数：文本提取、消息构造、UIMessage 转换、ToolSet 转换
import { tool } from 'ai';
import type { ModelMessage, UIMessage, ToolSet } from 'ai';
import type {
  AssistantModelMessage, ToolModelMessage, ToolResultPart, TextPart, ToolCallPart,
} from '@ai-sdk/provider-utils';
import type { Tool, ToolCall, ToolResult } from '../tool/types.js';

/**
 * 提取消息的纯文本内容（string content 直接返回，parts 拼接全部 text part）。
 */
export function getMessageText(msg: ModelMessage): string {
  if (typeof msg.content === 'string') return msg.content;
  return (msg.content as Array<{ type: string; text?: string }>)
    .filter((p) => p.type === 'text')
    .map((p) => p.text ?? '')
    .join('');
}

/**
 * 选取消息组中的"主用户消息"：最后一条 user 角色消息，无则取末条。
 * 供 thread 标题、tracer 记录、ctx.userMessage 等单消息语义场景使用。
 */
export function pickPrimaryUserMessage(messages: ModelMessage[]): ModelMessage | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') return messages[i];
  }
  return messages[messages.length - 1];
}

/**
 * 从 assistant 消息的 tool-call parts 提取 Vico ToolCall 列表。
 */
export function getToolCalls(msg: ModelMessage): ToolCall[] {
  if (msg.role !== 'assistant' || typeof msg.content === 'string') return [];
  return msg.content
    .filter((p): p is ToolCallPart => p.type === 'tool-call')
    .map((p) => ({ id: p.toolCallId, name: p.toolName, args: (p.input ?? {}) as Record<string, unknown> }));
}

/** 在消息链中查找指定 toolCallId 的 tool-result part */
function findToolResult(messages: ModelMessage[], toolCallId: string): ToolResultPart | undefined {
  for (const m of messages) {
    if (m.role !== 'tool') continue;
    for (const p of m.content) {
      if (p.type === 'tool-result' && p.toolCallId === toolCallId) return p;
    }
  }
  return undefined;
}

/**
 * 消息链中是否已存在指定 toolCallId 的工具结果（幂等恢复用）。
 */
export function hasToolResult(messages: ModelMessage[], toolCallId: string): boolean {
  return findToolResult(messages, toolCallId) !== undefined;
}

/**
 * 提取指定 toolCallId 的工具结果文本（text/error-text 直接取值，其余 JSON 序列化）。
 */
export function getToolResultText(messages: ModelMessage[], toolCallId: string): string | undefined {
  const part = findToolResult(messages, toolCallId);
  if (!part) return undefined;
  const output = part.output;
  if (output.type === 'text' || output.type === 'error-text') return output.value;
  return JSON.stringify((output as { value?: unknown }).value ?? null);
}

/**
 * 构造原生 assistant 消息：文本 + 工具调用 parts。content 数组不能为空，兜底空文本。
 */
export function buildAssistantMessage(text: string, toolCalls: ToolCall[]): AssistantModelMessage {
  const parts: Array<TextPart | ToolCallPart> = [];
  if (text) parts.push({ type: 'text', text });
  for (const tc of toolCalls) {
    parts.push({ type: 'tool-call', toolCallId: tc.id, toolName: tc.name, input: tc.args });
  }
  if (parts.length === 0) parts.push({ type: 'text', text: '' });
  return { role: 'assistant', content: parts };
}

/**
 * 构造原生 tool 消息：Vico ToolResult → tool-result part（成功 text / 失败 error-text）。
 *
 * @param result - Vico 工具执行结果
 * @param content - 已 resolve（可能截断）的结果文本
 */
export function buildToolResultMessage(result: ToolResult, content: string): ToolModelMessage {
  return {
    role: 'tool',
    content: [{
      type: 'tool-result',
      toolCallId: result.callId,
      toolName: result.name,
      output: result.status === 'success'
        ? { type: 'text', value: content }
        : { type: 'error-text', value: content },
    }],
  };
}

/**
 * ModelMessage → UIMessage（历史展示用，仅保留有文本的 system/user/assistant 消息）。
 * ai 包无官方反向转换，此处只做文本级降级转换。
 */
export function modelMessageToUIMessage(msg: ModelMessage, id: string): UIMessage | undefined {
  if (msg.role === 'tool') return undefined;
  const text = getMessageText(msg);
  if (!text) return undefined;
  return { id, role: msg.role, parts: [{ type: 'text', text }] };
}

/**
 * Vico Tool[] → ai ToolSet（供 prepareTools 转换为 provider 工具格式）。
 * 审批/策略元数据不进入 ToolSet，由 Vico loop 自行管理。
 */
export function toToolSet(tools: Tool[]): ToolSet {
  return Object.fromEntries(
    tools.map((t) => [t.name, tool({ description: t.description, inputSchema: t.inputSchema })]),
  );
}
