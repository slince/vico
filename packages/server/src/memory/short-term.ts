import { config } from '../config.js';
import { getDb } from '../db/db.js';

export interface ShortTermMessage {
  role: string;
  content: string;
  timestamp: number;
}

class ShortTermMemory {
  private cache: Map<string, ShortTermMessage[]> = new Map();

  getContext(conversationId: string): ShortTermMessage[] {
    if (this.cache.has(conversationId)) {
      return this.cache.get(conversationId)!;
    }

    const db = getDb();
    const rows = db.prepare(
      'SELECT role, content, created_at FROM messages WHERE conversation_id = ? ORDER BY created_at DESC LIMIT ?'
    ).all(conversationId, config.memory.stm_window * 2) as { role: string; content: string; created_at: number }[];

    const messages = rows.reverse().map((r) => ({
      role: r.role,
      content: r.content,
      timestamp: r.created_at,
    }));

    this.cache.set(conversationId, messages);
    return messages;
  }

  push(conversationId: string, message: ShortTermMessage) {
    const msgs = this.cache.get(conversationId) || [];
    msgs.push(message);

    const maxMessages = config.memory.stm_window * 2;
    while (msgs.length > maxMessages) {
      msgs.shift();
    }

    this.cache.set(conversationId, msgs);
  }

  clear(conversationId: string) {
    this.cache.delete(conversationId);
  }
}

export const shortTermMemory = new ShortTermMemory();
