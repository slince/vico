/**
 * 多租户 ThreadStore 包装器 — 通过 threadId 加前缀实现数据隔离。
 */
import type { ThreadStore, Thread, Turn, Message } from '@vico/agent';

export class TenantThreadStore implements ThreadStore {
  constructor(
    private tenantId: string,
    private delegate: ThreadStore,
  ) {}

  private key(threadId: string): string {
    return `t:${this.tenantId}:${threadId}`;
  }

  async createThread(agentId: string, title: string, id: string, opts?: { userId?: string; metadata?: Record<string, unknown> }): Promise<Thread> {
    return this.delegate.createThread(agentId, title, this.key(id), opts);
  }

  async getThread(threadId: string): Promise<Thread | undefined> {
    return this.delegate.getThread(this.key(threadId));
  }

  async listThreads(filter?: { agentId?: string; userId?: string }): Promise<Thread[]> {
    return this.delegate.listThreads(filter);
  }

  async createTurn(threadId: string): Promise<Turn> {
    return this.delegate.createTurn(this.key(threadId));
  }

  async updateTurn(turnId: string, patch: Partial<Turn>): Promise<void> {
    return this.delegate.updateTurn(turnId, patch);
  }

  async getTurn(turnId: string): Promise<Turn | undefined> {
    return this.delegate.getTurn(turnId);
  }

  async appendEntry(entry: Omit<Message, 'id' | 'createdAt'>): Promise<Message> {
    return this.delegate.appendEntry({
      ...entry,
      threadId: this.key(entry.threadId),
    });
  }

  async getEntries(threadId: string, options?: { limit?: number; start?: number }): Promise<Message[]> {
    return this.delegate.getEntries(this.key(threadId), options);
  }

  async getRecentEntries(threadId: string, limit: number): Promise<Message[]> {
    return this.delegate.getRecentEntries(this.key(threadId), limit);
  }
}
