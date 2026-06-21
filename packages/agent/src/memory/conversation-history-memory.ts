// src/memory/conversation-history-memory.ts
import type { ThreadStore } from '../thread/types.js';
import type { ModelMessage, MessageRole } from '../model/types.js';

/** 包装 ThreadStore，以 FIFO 滑动窗口读取会话历史并转为模型格式 */
export class ConversationHistoryMemory {
  constructor(readonly threadStore: ThreadStore) {}

  async get(threadId: string, window: number): Promise<ModelMessage[]> {
    const entries = await this.threadStore.getRecentEntries(threadId, window);

    return entries.map((entry) => {
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
  }
}
