/** src/thread/memory-thread-store.ts */
import type { ThreadStore, Thread, Turn, Message } from './types.js';
/** 内存版 ThreadStore — 所有数据存于 Map，进程重启后丢失 */
export class InMemoryThreadStore implements ThreadStore {
  private threads: Map<string, Thread> = new Map();
  private turns: Map<string, Turn> = new Map();
  private messages: Map<string, Message[]> = new Map();

  // Thread 操作

  async createThread(agentId: string, title: string, id: string): Promise<Thread> {
    const now = Date.now();
    const thread: Thread = {
      id,
      agentId,
      title,
      createdAt: now,
      updatedAt: now,
    };
    this.threads.set(thread.id, thread);
    return thread;
  }

  async getThread(threadId: string): Promise<Thread | undefined> {
    return this.threads.get(threadId);
  }

  async listThreads(agentId?: string): Promise<Thread[]> {
    const all = [...this.threads.values()];
    if (agentId) return all.filter((t) => t.agentId === agentId);
    return all;
  }

  // Turn 操作

  async createTurn(threadId: string): Promise<Turn> {
    const turn: Turn = {
      id: crypto.randomUUID(),
      threadId,
      status: 'running',
      steps: 0,
      createdAt: Date.now(),
    };
    this.turns.set(turn.id, turn);
    return turn;
  }

  async updateTurn(turnId: string, patch: Partial<Turn>): Promise<void> {
    const turn = this.turns.get(turnId);
    if (turn) Object.assign(turn, patch);
  }

  async getTurn(turnId: string): Promise<Turn | undefined> {
    return this.turns.get(turnId);
  }

  // Message 操作

  async appendEntry(entry: Omit<Message, 'id' | 'createdAt'>): Promise<Message> {
    const msg: Message = {
      ...entry,
      id: crypto.randomUUID(),
      createdAt: Date.now(),
    };
    const list = this.messages.get(entry.threadId) ?? [];
    list.push(msg);
    this.messages.set(entry.threadId, list);
    return msg;
  }

  async getEntries(threadId: string, options?: { limit?: number; start?: number }): Promise<Message[]> {
    const list = this.messages.get(threadId) ?? [];
    const start = options?.start ?? 0;
    const end = options?.limit ? start + options.limit : undefined;
    return [...list].slice(start, end);
  }

  async getRecentEntries(threadId: string, limit: number): Promise<Message[]> {
    const list = this.messages.get(threadId) ?? [];
    return list.length > limit ? [...list].slice(list.length - limit) : [...list];
  }
}
