/** src/thread/memory-thread-store.ts */
import type { ThreadStore, Thread, Turn, Message, ThreadContext } from './thread-store.js';
/** 内存版 ThreadStore — 所有数据存于 Map，进程重启后丢失 */
export class InMemoryThreadStore implements ThreadStore {
  private threads: Map<string, Thread> = new Map();
  private turns: Map<string, Turn> = new Map();
  private messages: Map<string, Message[]> = new Map();

  // Thread 操作

  async createThread(agentId: string, title: string, id: string, opts?: ThreadContext): Promise<Thread> {
    const now = Date.now();
    const thread: Thread = {
      id,
      agentId,
      userId: opts?.userId,
      title,
      metadata: opts?.metadata,
      createdAt: now,
      updatedAt: now,
    };
    this.threads.set(thread.id, thread);
    return thread;
  }

  async getThread(threadId: string): Promise<Thread | undefined> {
    return this.threads.get(threadId);
  }

  async listThreads(filter?: { agentId?: string; userId?: string }): Promise<Thread[]> {
    const all = [...this.threads.values()];
    return all.filter((t) => {
      if (filter?.agentId && t.agentId !== filter.agentId) return false;
      if (filter?.userId && t.userId !== filter.userId) return false;
      return true;
    });
  }

  async updateThread(threadId: string, patch: Partial<Pick<Thread, 'title' | 'metadata'>>): Promise<void> {
    const t = this.threads.get(threadId);
    if (!t) return;
    if (patch.title !== undefined) t.title = patch.title;
    if (patch.metadata !== undefined) t.metadata = patch.metadata;
    t.updatedAt = Date.now();
  }

  async deleteThread(threadId: string): Promise<void> {
    this.threads.delete(threadId);
    this.messages.delete(threadId);
    for (const [turnId, turn] of this.turns) {
      if (turn.threadId === threadId) this.turns.delete(turnId);
    }
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

  async appendEntries(entries: Omit<Message, 'id' | 'createdAt'>[]): Promise<Message[]> {
    return entries.map(entry => {
      const msg: Message = {
        ...entry,
        id: crypto.randomUUID(),
        createdAt: Date.now(),
      };
      const list = this.messages.get(entry.threadId) ?? [];
      list.push(msg);
      this.messages.set(entry.threadId, list);
      return msg;
    });
  }

  async getEntries(threadId: string, options?: { limit?: number; start?: number; roles?: string[] }): Promise<Message[]> {
    let list = this.messages.get(threadId) ?? [];
    if (options?.roles?.length) {
      const roleSet = new Set(options.roles);
      list = list.filter((m) => roleSet.has(m.role));
    }
    const start = options?.start ?? 0;
    const end = options?.limit ? start + options.limit : undefined;
    return [...list].slice(start, end);
  }

  async getLatestTurn(threadId: string): Promise<Turn | undefined> {
    let latest: Turn | undefined;
    for (const turn of this.turns.values()) {
      if (turn.threadId === threadId) {
        if (!latest || turn.createdAt > latest.createdAt) {
          latest = turn;
        }
      }
    }
    return latest;
  }

  async getRecentTurns(threadId: string, limit: number, status?: Turn['status']): Promise<Turn[]> {
    const result: Turn[] = [];
    for (const turn of this.turns.values()) {
      if (turn.threadId === threadId && (!status || turn.status === status)) {
        result.push(turn);
      }
    }
    result.sort((a, b) => b.createdAt - a.createdAt);
    return result.slice(0, limit);
  }

  async getEntriesByTurns(turnIds: string[]): Promise<Message[]> {
    if (turnIds.length === 0) return [];
    const ids = new Set(turnIds);
    const all: Message[] = [];
    for (const list of this.messages.values()) {
      for (const m of list) {
        if (ids.has(m.turnId)) all.push(m);
      }
    }
    all.sort((a, b) => a.createdAt - b.createdAt);
    return all;
  }

}
