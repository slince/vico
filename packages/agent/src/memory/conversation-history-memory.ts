// src/memory/conversation-history-memory.ts
import type {ThreadStore} from '../thread/types.js';
import type {MessageRole, ModelMessage} from '../model/types.js';

/**
 * 过滤掉消息列表中所有孤立的 tool 消息。
 * 截断窗口可能导致 tool 消息丢失了对应的 assistant(tool_use)，
 * 直接发给模型会报 "unexpected tool_use_id" 错误。
 * 遍历全部消息收集已知 toolCallId，然后过滤掉无法匹配的 tool 消息。
 */
function stripOrphanedToolResults(messages: ModelMessage[]): ModelMessage[] {
  const knownToolCallIds = new Set<string>();
  for (const m of messages) {
    if (m.role === 'assistant' && m.toolCalls) {
      for (const tc of m.toolCalls) {
        knownToolCallIds.add(tc.id);
      }
    }
  }

  return messages.filter(m => {
    if (m.role === 'tool' && m.toolCallId) {
      return knownToolCallIds.has(m.toolCallId);
    }
    return true;
  });
}

/**
 * 包装 ThreadStore，按已完结轮次读取会话历史并转为模型格式。
 * conversationWindow 表示取最近 N 轮已完结的轮次（status === 'completed'）。
 */
export class ConversationHistoryMemory {

  constructor(readonly threadStore: ThreadStore, readonly conversationWindow: number) {}

  async get(threadId: string): Promise<ModelMessage[]> {
    const turns = await this.threadStore.getRecentTurns(threadId, this.conversationWindow, 'completed');

    if (turns.length === 0) return [];

    // 批量加载各轮次的消息（单次查询）
    const entries = await this.threadStore.getEntriesByTurns(turns.map((t) => t.id));

    const messages = entries.map((entry) => {
      const msg: ModelMessage = {
        role: entry.role as MessageRole,
        content: entry.content,
      };
      if (entry.toolCalls) {
        msg.toolCalls = entry.toolCalls as ModelMessage['toolCalls'];
      }
      if (entry.toolCallId) {
        msg.toolCallId = entry.toolCallId;
      }
      return msg;
    });

    return stripOrphanedToolResults(messages);
  }
}
