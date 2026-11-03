// src/thread/utils.ts — ThreadStore Message 与原生 ModelMessage 的相互转换
import type {Message, MessageContent} from './thread-store.js';
import type {UsageMetrics} from '@vico/types';
import type {ModelMessage} from '@ai-sdk/provider-utils';

/**
 * ThreadStore Message → AgentMessage（content 原样透传，usage 从 metadata 还原，turnId 原样透传）。
 * summary 是压缩内部角色，provider 不识别，统一映射为 user 消息注入。
 */
export function toModelMessages(entries: Message[]): AgentMessage[] {
  return entries.map((e) => {
    const role = e.role === 'summary' ? 'user' : e.role;
    const msg = { role, content: e.content, turnId: e.turnId } as AgentMessage;
    // usage 由 fromModelMessage 写入 metadata，这里还原到消息载体上
    if (e.metadata?.usage !== undefined) {
      msg.usage = e.metadata.usage as UsageMetrics;
    }
    return msg;
  });
}

/**
 * 可持久化消息：原生 ModelMessage 附带可选 usage（该次调用的完整用量，仅 assistant 消息携带）。
 * 与 AgentMessage 的区别在于不要求自带 turnId —— 持久化时 turnId 由持久化方统一补充。
 */
export type PersistableMessage = ModelMessage & { usage?: UsageMetrics };

/**
 * Agent 内部统一消息载体：PersistableMessage 附所属 turnId（必传），消息自描述所属 turn。
 */
export type AgentMessage = PersistableMessage & { turnId: string };

/**
 * 原生 ModelMessage → ThreadStore 持久化字段（content 原样透传，usage 写入 metadata）。
 * usage 仅存在于持久化副本，不进入发往模型的消息链。
 */
export function fromModelMessage(msg: PersistableMessage): Pick<Message, 'role'|'content'|'metadata'> {
  const entry: Pick<Message, 'role'|'content'|'metadata'> = {
    role: msg.role,
    content: msg.content,
  };
  if (msg.usage) entry.metadata = { usage: msg.usage };
  return entry;
}

/**
 * Message.content → DB 列（TEXT）：JSON.stringify 落库。
 * 仅供存储适配器在持久化边界使用；内存互转（fromModelMessage / toModelMessages）不再做 JSON。
 */
export function serializeContent(content: MessageContent): string {
  return JSON.stringify(content);
}

/**
 * DB 列（TEXT）→ Message.content：JSON.parse 还原，解析失败按纯文本兜底（防御历史脏数据）。
 */
export function deserializeContent(raw: string): MessageContent {
  try {
    return JSON.parse(raw) as MessageContent;
  } catch {
    return raw;
  }
}
