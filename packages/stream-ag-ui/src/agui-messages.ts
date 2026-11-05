// @vico/stream-ag-ui - ThreadStore Message → ag-ui Message 转换（历史展示用）。
//
// 后端持久化仍是 ModelMessage.content；本模块只做 model → ag-ui 的展示映射。
// 前端用 @assistant-ui/react-ag-ui 的 fromAgUiMessages 还原为 assistant-ui 消息。
import type {AssistantMessage, Message as AgUiMessage, ReasoningMessage, SystemMessage, ToolCall, ToolMessage, UserMessage} from '@ag-ui/core';
import type {ModelMessage} from '@vico/model';
import type {Message} from '@vico/thread';
import {modelContentToAguiContent, type ModelUserContentParts} from './content-parts.js';

/** 提取 parts 数组中的纯文本 */
function textOf(content: Extract<ModelMessage['content'], unknown[]>): string {
  return content
    .filter((p) => (p as { type: string }).type === 'text')
    .map((p) => (p as { text?: string }).text ?? '')
    .join('');
}

/** tool-result output → 文本（text 原样，其余 JSON 序列化） */
function toolOutputText(output: unknown): { text: string; isError: boolean } {
  const o = output as { type?: string; value?: unknown };
  if (o?.type === 'text') return { text: String(o.value ?? ''), isError: false };
  if (o?.type === 'error-text') return { text: String(o.value ?? ''), isError: true };
  if (o?.type === 'error-json') return { text: JSON.stringify(o.value), isError: true };
  if (o?.type === 'execution-denied') return { text: 'Tool execution denied', isError: true };
  return { text: o?.value !== undefined ? JSON.stringify(o.value) : JSON.stringify(output), isError: false };
}

/**
 * ThreadStore Message → ag-ui Message（历史展示用）。
 *
 * - assistant 的 reasoning part → 独立 ReasoningMessage（fromAgUiMessages 会折叠回 assistant）
 * - assistant 的 tool-call part → AssistantMessage.toolCalls
 * - tool 消息的 tool-result part → ToolMessage（error 走 error 字段）
 *
 * @param entries - 线程存储返回的消息条目（content 为原生 ModelMessage.content）
 * @returns 可直接由前端 fromAgUiMessages 还原的 ag-ui 消息数组
 */
export function toAgUiMessages(entries: Message[]): AgUiMessage[] {
  const result: AgUiMessage[] = [];

  for (const entry of entries) {
    const content = entry.content;

    if (typeof content === 'string') {
      result.push({ id: entry.id, role: entry.role as AgUiMessage['role'], content } as AgUiMessage);
      continue;
    }

    switch (entry.role) {
      case 'user': {
        const msg: UserMessage = {
          id: entry.id,
          role: 'user',
          // user 消息 content 实为 TextPart/ImagePart/FilePart，完整映射保留媒体 part
          content: modelContentToAguiContent(content as ModelUserContentParts),
          ...(entry.metadata ? { metadata: entry.metadata as Record<string, unknown> } : {}),
        };
        result.push(msg);
        break;
      }

      case 'system': {
        const msg: SystemMessage = { id: entry.id, role: 'system', content: textOf(content) };
        result.push(msg);
        break;
      }

      case 'assistant': {
        const reasoningParts = content.filter((p) => (p as { type: string }).type === 'reasoning');
        const text = textOf(content);
        const toolCalls: ToolCall[] = content
          .filter((p) => (p as { type: string }).type === 'tool-call')
          .map((p) => {
            const tc = p as { toolCallId: string; toolName: string; input: unknown };
            return {
              id: tc.toolCallId,
              type: 'function' as const,
              function: { name: tc.toolName, arguments: JSON.stringify(tc.input) },
            };
          });

        // reasoning → 独立 ReasoningMessage（置于 assistant 之前）
        for (const r of reasoningParts) {
          const msg: ReasoningMessage = { id: `${entry.id}:reasoning`, role: 'reasoning', content: (r as { text?: string }).text ?? '' };
          result.push(msg);
        }

        const msg: AssistantMessage = {
          id: entry.id,
          role: 'assistant',
          content: text,
          ...(toolCalls.length > 0 ? { toolCalls } : {}),
          ...(entry.metadata ? { metadata: entry.metadata as Record<string, unknown> } : {}),
        };
        result.push(msg);
        break;
      }

      case 'tool': {
        for (const p of content) {
          const part = p as { type: string; toolCallId?: string; output?: unknown };
          if (part.type === 'tool-result' && part.toolCallId) {
            const { text, isError } = toolOutputText(part.output);
            const msg: ToolMessage = {
              id: entry.id,
              role: 'tool',
              content: text,
              toolCallId: part.toolCallId,
              ...(isError ? { error: text } : {}),
            };
            result.push(msg);
          }
          // tool-approval-response 由 fromAgUiMessages 无法还原，历史里忽略（审批态已随 checkpoint 恢复）
        }
        break;
      }

      default:
        // 未知角色静默跳过
        break;
    }
  }

  return result;
}
