// src/thread/utils.ts — ThreadStore Message 与原生 ModelMessage/UIMessage 的相互转换
import type {Message} from './thread-store.js';
import type {ModelMessage, UIMessage} from 'ai';

/**
 * ThreadStore Message → 原生 ModelMessage（content 反序列化）。
 * 解析失败时按纯文本内容兜底（防御历史脏数据）。
 */
export function toModelMessages(entries: Message[]): ModelMessage[] {
  return entries.map((e) => {
    let content: unknown;
    try {
      content = JSON.parse(e.content);
    } catch {
      content = e.content;
    }
    return { role: e.role, content } as ModelMessage;
  });
}



/**
 * 原生 ModelMessage → ThreadStore 持久化字段（content 序列化）。
 */
export function fromModelMessage(msg: ModelMessage): Pick<Message, 'role'|'content'> {
  return { role: msg.role, content: JSON.stringify(msg.content) };
}

/** UIMessage 的宽松形态 — parts 以 Record 承载，规避 AI SDK tool part 模板字面量类型的强约束 */
interface UIMessageLike {
  id: string;
  role: UIMessage['role'];
  parts: Record<string, unknown>[];
}

/**
 * 解析 Message.content，成功时返回 parts 数组，失败时按原文兜底。
 */
function parseContent(content: string): unknown {
  try {
    return JSON.parse(content);
  } catch {
    return content;
  }
}

/**
 * ModelMessage 的 tool-call part → UIMessage 的 tool-${toolName} part（初始 input-available，
 * 等待后续 tool-result 合并为 output-available / output-error）。
 */
function toToolUIPart(part: Record<string, unknown>): Record<string, unknown> {
  return {
    type: `tool-${part.toolName ?? 'unknown'}`,
    toolCallId: part.toolCallId,
    input: part.input,
    state: 'input-available',
  };
}

/** 判断 part 是否为 UIMessage 的静态 tool part（type 以 tool- 开头） */
function isToolUIPartLike(part: Record<string, unknown>): boolean {
  return typeof part.type === 'string' && part.type.startsWith('tool-');
}

/**
 * ThreadStore Message → UIMessage（历史展示用）。
 *
 * - tool 角色消息不产出独立 UIMessage，其 tool-result part 按 toolCallId 合并到最近一条
 *   assistant 消息的对应 tool part，将 state 置为 output-available（成功）或 output-error（失败）。
 * - assistant 消息的 tool-call part 类型由 ModelMessage 的 `tool-call` 转为 UIMessage 的 `tool-${toolName}`。
 * - user / assistant / system 角色原样保留；未知角色静默跳过。
 *
 * @param entries - ThreadStore 消息记录
 * @returns 可直接渲染的 UIMessage 数组
 */
export function toUiMessages(entries: Message[]): UIMessage[] {
  const result: UIMessageLike[] = [];
  let lastAssistantIndex = -1;

  for (const entry of entries) {
    const content = parseContent(entry.content);

    // tool 消息 → 合并 tool-result 到最近 assistant 的 tool part
    if (entry.role === 'tool') {
      if (lastAssistantIndex < 0 || !Array.isArray(content)) continue;
      const assistant = result[lastAssistantIndex]!;
      for (const part of content as Record<string, unknown>[]) {
        if (part.type !== 'tool-result' || typeof part.toolCallId !== 'string') continue;
        const output = part.output as { type?: string; value?: unknown } | undefined;
        assistant.parts = assistant.parts.map((ap) => {
          if (!isToolUIPartLike(ap) || ap.toolCallId !== part.toolCallId) return ap;
          if (output?.type === 'error-text') {
            return { ...ap, state: 'output-error', errorText: output.value };
          }
          return { ...ap, state: 'output-available', output: output?.value };
        });
      }
      continue;
    }

    // 仅 user / assistant / system 产出 UIMessage，未知角色跳过
    if (entry.role !== 'user' && entry.role !== 'assistant' && entry.role !== 'system') continue;

    const parts = Array.isArray(content)
      ? (content as Record<string, unknown>[]).map((part) =>
          part.type === 'tool-call' ? toToolUIPart(part) : part,
        )
      : [{ type: 'text', text: String(content ?? '') }];

    result.push({ id: entry.id, role: entry.role, parts });
    if (entry.role === 'assistant') lastAssistantIndex = result.length - 1;
  }

  return result as unknown as UIMessage[];
}
