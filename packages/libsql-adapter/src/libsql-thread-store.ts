// @vico/libsql-adapter — Drizzle-backed ThreadStore implementation
import { eq, desc, inArray, and } from 'drizzle-orm';
import type { LibSQLDatabase } from 'drizzle-orm/libsql';
import type { ThreadStore, Thread, Turn, Message } from '@vico/agent';
import {
  threads,
  turns,
  messages,
} from './schema.js';
import type * as schema from './schema.js';

/** LibSqlThreadStore 构造选项 */
export interface LibSqlThreadStoreOptions {
  /** Drizzle LibSQL 数据库实例（schema 需包含本包的表） */
  db: LibSQLDatabase<typeof schema>;
}

/**
 * LibSQL 版 ThreadStore。
 * 无租户过滤，适合单租户场景；多租户请外层包装 WHERE tenant_id。
 */
export class LibSqlThreadStore implements ThreadStore {
  private db: LibSQLDatabase<typeof schema>;

  constructor(options: LibSqlThreadStoreOptions) {
    this.db = options.db;
  }

  // --- Thread ---

  async createThread(agentId: string, title: string, id: string, opts?: { userId?: string; metadata?: Record<string, unknown> }): Promise<Thread> {
    const threadId = id || crypto.randomUUID();
    const now = Date.now();
    await this.db.insert(threads).values({
      id: threadId,
      agent_id: agentId,
      user_id: opts?.userId ?? null,
      title: title ?? null,
      metadata: opts?.metadata ? JSON.stringify(opts.metadata) : null,
      created_at: now,
      updated_at: now,
    });
    return { id: threadId, agentId, userId: opts?.userId, title: title || undefined, metadata: opts?.metadata, createdAt: now, updatedAt: now };
  }

  async getThread(threadId: string): Promise<Thread | undefined> {
    const rows = await this.db
      .select()
      .from(threads)
      .where(eq(threads.id, threadId))
      .limit(1);
    return rows.length === 0 ? undefined : this._toThread(rows[0]);
  }

  async listThreads(filter?: { agentId?: string; userId?: string }): Promise<Thread[]> {
    let base = this.db
      .select()
      .from(threads)
      .orderBy(desc(threads.updated_at));
    if (filter?.agentId) {
      base = base.where(eq(threads.agent_id, filter.agentId)) as typeof base;
    }
    if (filter?.userId) {
      base = base.where(eq(threads.user_id, filter.userId)) as typeof base;
    }
    const rows = await base;
    return rows.map((r) => this._toThread(r));
  }

  async updateThread(threadId: string, patch: Partial<Pick<Thread, 'title' | 'metadata'>>): Promise<void> {
    const values: Record<string, unknown> = { updated_at: Date.now() };
    if (patch.title !== undefined) values.title = patch.title;
    if (patch.metadata !== undefined) values.metadata = JSON.stringify(patch.metadata);
    if (Object.keys(values).length === 1) return; // only updated_at
    await this.db.update(threads).set(values).where(eq(threads.id, threadId));
  }

  // --- Turn ---

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
    if (patch.metadata !== undefined) values.metadata = JSON.stringify(patch.metadata);
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
    return rows.length === 0 ? undefined : this._toTurn(rows[0]);
  }

  // --- Message ---

  async appendEntry(
    entry: Omit<Message, 'id' | 'createdAt'>,
  ): Promise<Message> {
    const id = crypto.randomUUID();
    const now = Date.now();
    await this.db.insert(messages).values({
      id,
      thread_id: entry.threadId,
      turn_id: entry.turnId,
      role: entry.role,
      content: entry.content,
      tool_call_id: entry.toolCallId ?? null,
      tool_calls: entry.toolCalls ? JSON.stringify(entry.toolCalls) : null,
      tool_results: entry.toolResults
        ? JSON.stringify(entry.toolResults)
        : null,
      metadata: entry.metadata ? JSON.stringify(entry.metadata) : null,
      created_at: now,
    });
    return { ...entry, id, createdAt: now };
  }

  async getEntries(
    threadId: string,
    options?: { limit?: number; start?: number },
  ): Promise<Message[]> {
    const start = options?.start ?? 0;
    const base = this.db
      .select()
      .from(messages)
      .where(eq(messages.thread_id, threadId))
      .orderBy(messages.created_at)
      .offset(start);
    const rows = await (options?.limit ? base.limit(options.limit) : base);
    return rows.map((r) => this._toMessage(r));
  }

  async getEntriesByTurns(turnIds: string[]): Promise<Message[]> {
    if (turnIds.length === 0) return [];
    const rows = await this.db
      .select()
      .from(messages)
      .where(inArray(messages.turn_id, turnIds))
      .orderBy(messages.created_at);
    return rows.map((r) => this._toMessage(r));
  }

  async getRecentTurns(threadId: string, limit: number, status?: Turn['status']): Promise<Turn[]> {
    const conditions = [eq(turns.thread_id, threadId)];
    if (status) {
      conditions.push(eq(turns.status, status));
    }
    const rows = await this.db
      .select()
      .from(turns)
      .where(and(...conditions))
      .orderBy(desc(turns.created_at))
      .limit(limit);
    return rows.map((r) => this._toTurn(r));
  }

  async getLatestTurn(threadId: string): Promise<Turn | undefined> {
    const rows = await this.db
      .select()
      .from(turns)
      .where(eq(turns.thread_id, threadId))
      .orderBy(desc(turns.created_at))
      .limit(1);
    return rows.length === 0 ? undefined : this._toTurn(rows[0]);
  }

  // --- Private mappers ---

  private _toThread(r: typeof threads.$inferSelect): Thread {
    return {
      id: r.id,
      agentId: r.agent_id,
      userId: r.user_id ?? undefined,
      title: r.title ?? undefined,
      metadata: r.metadata ? (JSON.parse(r.metadata) as Record<string, unknown>) : undefined,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

  private _toTurn(r: typeof turns.$inferSelect): Turn {
    return {
      id: r.id,
      threadId: r.thread_id,
      status: r.status as Turn['status'],
      steps: r.steps,
      metadata: r.metadata ? (JSON.parse(r.metadata) as Record<string, unknown>) : undefined,
      createdAt: r.created_at,
    };
  }

  private _toMessage(r: typeof messages.$inferSelect): Message {
    return {
      id: r.id,
      threadId: r.thread_id,
      turnId: r.turn_id,
      role: r.role,
      content: r.content,
      toolCallId: r.tool_call_id ?? undefined,
      toolCalls: r.tool_calls
        ? (JSON.parse(r.tool_calls) as unknown)
        : undefined,
      toolResults: r.tool_results
        ? (JSON.parse(r.tool_results) as unknown)
        : undefined,
      metadata: r.metadata ? (JSON.parse(r.metadata) as Record<string, unknown>) : undefined,
      createdAt: r.created_at,
    };
  }
}
