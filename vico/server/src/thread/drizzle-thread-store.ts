/** DrizzleThreadStore — 基于 Drizzle ORM + server schema 的 ThreadStore 实现 */
import { eq, desc } from 'drizzle-orm';
import type { ThreadStore, Thread, Turn, Message } from '@vico/agent';
import { getDb, schema } from '../db/db.js';

const { threads, turns, thread_messages } = schema;

/** DrizzleThreadStore 配置 */
export interface DrizzleThreadStoreOptions {
  /** 租户 ID — 所有查询自动过滤 */
  tenantId: string;
}

/**
 * Drizzle ORM 版 ThreadStore — 数据持久化到 SQLite。
 * 使用 server schema 中定义的 threads/turns/thread_messages 表。
 */
export class DrizzleThreadStore implements ThreadStore {
  private tenantId: string;

  constructor(options: DrizzleThreadStoreOptions) {
    this.tenantId = options.tenantId;
  }

  private get db() {
    return getDb();
  }

  // Thread 操作

  async createThread(agentId: string, title: string, id: string): Promise<Thread> {
    const now = Date.now();
    await this.db.insert(threads).values({
      id,
      tenant_id: this.tenantId,
      agent_id: agentId,
      title: title || null,
      created_at: now,
      updated_at: now,
    });
    return { id, agentId, title, createdAt: now, updatedAt: now };
  }

  async getThread(threadId: string): Promise<Thread | undefined> {
    const rows = await this.db
      .select()
      .from(threads)
      .where(eq(threads.id, threadId))
      .limit(1);
    if (rows.length === 0) return undefined;
    return this.toThread(rows[0]);
  }

  async listThreads(agentId?: string): Promise<Thread[]> {
    const rows = await this.db
      .select()
      .from(threads)
      .where(eq(threads.tenant_id, this.tenantId))
      .orderBy(desc(threads.updated_at));
    return rows
      .filter((r) => !agentId || r.agent_id === agentId)
      .map((r) => this.toThread(r));
  }

  // Turn 操作

  async createTurn(threadId: string): Promise<Turn> {
    const id = crypto.randomUUID();
    const now = Date.now();
    await this.db.insert(turns).values({
      id,
      thread_id: threadId,
      status: 'running',
      steps: 0,
      created_at: now,
    });
    return { id, threadId, status: 'running', steps: 0, createdAt: now };
  }

  async updateTurn(turnId: string, patch: Partial<Turn>): Promise<void> {
    const values: Record<string, unknown> = {};
    if (patch.status !== undefined) values.status = patch.status;
    if (patch.steps !== undefined) values.steps = patch.steps;
    if (Object.keys(values).length === 0) return;
    await this.db
      .update(turns)
      .set(values)
      .where(eq(turns.id, turnId));
  }

  async getTurn(turnId: string): Promise<Turn | undefined> {
    const rows = await this.db
      .select()
      .from(turns)
      .where(eq(turns.id, turnId))
      .limit(1);
    if (rows.length === 0) return undefined;
    return this.toTurn(rows[0]);
  }

  // Message 操作

  async appendEntry(entry: Omit<Message, 'id' | 'createdAt'>): Promise<Message> {
    const id = crypto.randomUUID();
    const now = Date.now();
    await this.db.insert(thread_messages).values({
      id,
      thread_id: entry.threadId,
      turn_id: entry.turnId,
      role: entry.role,
      content: entry.content,
      tool_calls: entry.toolCalls ? JSON.stringify(entry.toolCalls) : null,
      tool_results: entry.toolResults ? JSON.stringify(entry.toolResults) : null,
      created_at: now,
    });
    return { ...entry, id, createdAt: now };
  }

  async getEntries(threadId: string, options?: { limit?: number; start?: number }): Promise<Message[]> {
    const base = this.db
      .select()
      .from(thread_messages)
      .where(eq(thread_messages.thread_id, threadId))
      .orderBy(thread_messages.created_at);
    const start = options?.start ?? 0;
    const limit = options?.limit;
    const rows = limit ? await base.limit(limit).offset(start) : await base.offset(start);
    return rows.map((r) => this.toMessage(r));
  }

  async getRecentEntries(threadId: string, limit: number): Promise<Message[]> {
    const rows = await this.db
      .select()
      .from(thread_messages)
      .where(eq(thread_messages.thread_id, threadId))
      .orderBy(desc(thread_messages.created_at))
      .limit(limit);
    return rows.map((r) => this.toMessage(r));
  }

  // 映射辅助

  private toThread(r: typeof threads.$inferSelect): Thread {
    return {
      id: r.id,
      agentId: r.agent_id,
      title: r.title ?? undefined,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

  private toTurn(r: typeof turns.$inferSelect): Turn {
    return {
      id: r.id,
      threadId: r.thread_id,
      status: r.status as Turn['status'],
      steps: r.steps,
      createdAt: r.created_at,
    };
  }

  private toMessage(r: typeof thread_messages.$inferSelect): Message {
    return {
      id: r.id,
      threadId: r.thread_id,
      turnId: r.turn_id,
      role: r.role,
      content: r.content,
      toolCallId: undefined,
      toolCalls: r.tool_calls ? JSON.parse(r.tool_calls) : undefined,
      toolResults: r.tool_results ? JSON.parse(r.tool_results) : undefined,
      createdAt: r.created_at,
    };
  }
}
