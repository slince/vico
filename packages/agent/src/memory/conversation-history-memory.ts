// src/memory/conversation-history-memory.ts
import type {ModelMessage} from '../model/types.js';
import type {ConversationHistoryMemory} from './types.js';

/** 基于 Map 的 FIFO 滑动窗口实现 */
export class ConversationHistoryMemoryStore implements ConversationHistoryMemory {
  private threads: Map<string, ModelMessage[]> = new Map();

  async push(threadId: string, message: ModelMessage): Promise<void> {
    const msgs = this.threads.get(threadId) ?? [];
    msgs.push(message);
    this.threads.set(threadId, msgs);
  }

  async get(threadId: string, window: number): Promise<ModelMessage[]> {
    const msgs = this.threads.get(threadId) ?? [];
    if (msgs.length <= window) return [...msgs];
    return msgs.slice(msgs.length - window);
  }

  clear(threadId: string): void {
    this.threads.delete(threadId);
  }

  clearAll(): void {
    this.threads.clear();
  }
}
