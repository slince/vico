/** DrizzleSessionStore — 基于 Drizzle ORM + server schema 的 SessionStore 实现 */
import { eq, desc } from 'drizzle-orm';
import type { SessionStore, Thread, Turn, Message } from '@vico/agent';
import { getDb, schema } from '../db/db.js';

const { session_threads, session_turns, session_messages } = schema;

/** DrizzleSessionStore 配置 */
export interface DrizzleSessionStoreOptions {
  /** 租户 ID — 所有查询自动过滤 */
  tenantId: string;
}

/**
 * Drizzle ORM 版 SessionStore — 数据持久化到 SQLite。
 * 使用 server schema 中定义的 session_threads/session_turns/session_messages 表。
 */
export class DrizzleSessionStore implements SessionStore {
  private tenantId: string;

  constructor(options: DrizzleSessionStoreOptions) {
    this.tenantId = options.tenantId;
  }

  private get db() {
    return getDb();
  }

  // Thread 操作

  async createThread(agentId: string, title?: string): Promise<Thread> {
    const now = Date.now();
    const id = crypto.randomUUID();
    await this.db.insert(session_threads).values({
      id,
      tenant_id: this.tenantId,
      agent_id: agentId,
      title: title ?? null,
      created_at: now,
      updated_at: now,
    });
    return { id, agentId, title, createdAt: now, updatedAt: now };
  }

  async getThread(threadId: string): Promise<Thread | undefined> {
    const rows = await this.db
      .select()
      .from(session_threads)
      .where(eq(session_threads.id, threadId))
      .limit(1);
    if (rows.length === 0) return undefined;
    return this.toThread(rows[0]);
  }

  async listThreads(agentId?: string): Promise<Thread[]> {
    const rows = await this.db
      .select()
      .from(session_threads)
      .where(eq(session_threads.tenant_id, this.tenantId))
      .orderBy(desc(session_threads.updated_at));
    return rows
      .filter((r) => !agentId || r.agent_id === agentId)
      .map((r) => this.toThread(r));
  }

  // Turn 操作

  async createTurn(threadId: string): Promise<Turn> {
    const id = crypto.randomUUID();
    const now = Date.now();
    await this.db.insert(session_turns).values({
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
      .update(session_turns)
      .set(values)
      .where(eq(session_turns.id, turnId));
  }

  async getTurn(turnId: string): Promise<Turn | undefined> {
    const rows = await this.db
      .select()
      .from(session_turns)
      .where(eq(session_turns.id, turnId))
      .limit(1);
    if (rows.length === 0) return undefined;
    return this.toTurn(rows[0]);
  }

  // Message 操作

  async appendEntry(entry: Omit<Message, 'id' | 'createdAt'>): Promise<Message> {
    const id = crypto.randomUUID();
    const now = Date.now();
    await this.db.insert(session_messages).values({
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
      .from(session_messages)
      .where(eq(session_messages.thread_id, threadId))
      .orderBy(session_messages.created_at);
    const start = options?.start ?? 0;
    const limit = options?.limit;
    const rows = limit ? await base.limit(limit).offset(start) : await base.offset(start);
    return rows.map((r) => this.toMessage(r));
  }

  async getRecentEntries(threadId: string, limit: number): Promise<Message[]> {
    const rows = await this.db
      .select()
      .from(session_messages)
      .where(eq(session_messages.thread_id, threadId))
      .orderBy(desc(session_messages.created_at))
      .limit(limit);
    return rows.map((r) => this.toMessage(r));
  }

  // 映射辅助

  private toThread(r: typeof session_threads.$inferSelect): Thread {
    return {
      id: r.id,
      agentId: r.agent_id,
      title: r.title ?? undefined,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

  private toTurn(r: typeof session_turns.$inferSelect): Turn {
    return {
      id: r.id,
      threadId: r.thread_id,
      status: r.status as Turn['status'],
      steps: r.steps,
      createdAt: r.created_at,
    };
  }

  private toMessage(r: typeof session_messages.$inferSelect): Message {
    return {
      id: r.id,
      threadId: r.thread_id,
      turnId: r.turn_id,
      role: r.role,
      content: r.content,
      toolCalls: r.tool_calls ? JSON.parse(r.tool_calls) : undefined,
      toolResults: r.tool_results ? JSON.parse(r.tool_results) : undefined,
      createdAt: r.created_at,
    };
  }
}
