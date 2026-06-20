// src/memory/short-term-memory.ts
import type { ModelMessage } from '../model/model-client.js';

/** 短期记忆 — 基于 Map 的 FIFO 滑动窗口 */
export class ShortTermMemory {
  private threads: Map<string, ModelMessage[]> = new Map();

  push(threadId: string, message: ModelMessage): void {
    const msgs = this.threads.get(threadId) ?? [];
    msgs.push(message);
    this.threads.set(threadId, msgs);
  }

  get(threadId: string, window: number): ModelMessage[] {
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
