// src/thread/utils.ts — ThreadStore Message 与原生 ModelMessage/UIMessage 的相互转换
import type {Message} from './thread-store.js';
import type {ModelMessage, ToolUIPart, UIMessage} from 'ai';
import {ToolCallPart} from "@ai-sdk/provider-utils";

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

/**
 * 解析 Message.content 为规范形态（string 或 parts 数组）。
 * content 由 fromModelMessage 以 JSON.stringify 写入，反序列化即还原 ModelMessage.content。
 */
function parseContent(content: string): ModelMessage['content'] {
  return JSON.parse(content) as ModelMessage['content'];
}

/** 判断 UIMessage part 是否为静态 tool part（type 以 tool- 开头） */
function isToolUIPart(part: UIMessage['parts'][number]): part is ToolUIPart {
  return typeof part.type === 'string' && part.type.startsWith('tool-');
}

/**
 * ModelMessage tool-call part → UIMessage tool part（初始 input-available，
 * 等待后续 tool-result 合并改写为 output-available / output-error）。
 *
 * 依赖 UIMessage 默认泛型 TOOLS = UITools（Record<string, UITool>），
 * 使 type 的模板字面量 `tool-${string}` 可匹配任意动态工具名，无需自建宽松中间类型。
 */
function toToolUIPart(part: ToolCallPart): ToolUIPart {
  return {
    type: `tool-${part.toolName ?? 'unknown'}`,
    toolCallId: part.toolCallId ?? '',
    input: part.input,
    state: 'input-available',
  } as ToolUIPart;
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
  const result: UIMessage[] = [];
  let lastAssistantIndex = -1;

  for (const entry of entries) {
    const content = parseContent(entry.content);

    // tool 消息 → 合并 tool-result 到最近 assistant 的 tool part
    if (entry.role === 'tool') {
      if (lastAssistantIndex < 0 || !Array.isArray(content)) continue;
      const assistant = result[lastAssistantIndex]!;
      for (const raw of content) {
        if (raw.type !== 'tool-result' || typeof raw.toolCallId !== 'string') continue;
        const output = raw.output as { type?: string; value?: unknown } | undefined;
        assistant.parts = assistant.parts.map((ap) => {
          if (!isToolUIPart(ap) || ap.toolCallId !== raw.toolCallId) return ap;
          if (output?.type === 'error-text') {
            return { ...ap, state: 'output-error', errorText: String(output.value) } as ToolUIPart;
          }
          return { ...ap, state: 'output-available', output: output?.value } as ToolUIPart;
        });
      }
      continue;
    }

    // 仅 user / assistant / system 产出 UIMessage，未知角色跳过
    if (entry.role !== 'user' && entry.role !== 'assistant' && entry.role !== 'system') continue;

    let parts: UIMessage['parts'];
    if (Array.isArray(content)) {
      parts = content.map((p) => {
        if (p.type === 'tool-call') {
          return toToolUIPart(p);
        }
        return p as UIMessage['parts'][number];
      });
    } else {
      parts = [{ type: 'text', text: String(content) }];
    }

    result.push({ id: entry.id, role: entry.role, parts });
    if (entry.role === 'assistant') lastAssistantIndex = result.length - 1;
  }

  return result;
}
