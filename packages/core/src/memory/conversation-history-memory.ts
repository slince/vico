// src/memory/conversation-history-memory.ts
import type {ThreadStore} from '../thread/thread-store.js';
import type { ModelMessage } from 'ai';
import {toModelMessages} from '../agent/utils.js';


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

    return toModelMessages(entries);
  }
}
