// @vico/libsql — Drizzle-backed SessionStore implementation
import { eq, desc } from 'drizzle-orm';
import type { LibSQLDatabase } from 'drizzle-orm/libsql';
import type { SessionStore, Thread, Turn, Message } from '@vico/agent';
import {
  sessionThreads,
  sessionTurns,
  sessionMessages,
} from './schema.js';
import type * as schema from './schema.js';

/** DrizzleSessionStore 构造选项 */
export interface DrizzleSessionStoreOptions {
  /** Drizzle LibSQL 数据库实例（schema 需包含本包的表） */
  db: LibSQLDatabase<typeof schema>;
}

/**
 * Drizzle ORM 版 SessionStore — 持久化到 LibSQL。
 * 无租户过滤，适合单租户场景；多租户请外层包装 WHERE tenant_id。
 */
export class DrizzleSessionStore implements SessionStore {
  private db: LibSQLDatabase<typeof schema>;

  constructor(options: DrizzleSessionStoreOptions) {
    this.db = options.db;
  }

  // --- Thread ---

  async createThread(agentId: string, title?: string): Promise<Thread> {
    const id = crypto.randomUUID();
    const now = Date.now();
    await this.db.insert(sessionThreads).values({
      id,
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
      .from(sessionThreads)
      .where(eq(sessionThreads.id, threadId))
      .limit(1);
    return rows.length === 0 ? undefined : this._toThread(rows[0]);
  }

  async listThreads(agentId?: string): Promise<Thread[]> {
    const base = this.db
      .select()
      .from(sessionThreads)
      .orderBy(desc(sessionThreads.updated_at));
    const rows = await (agentId
      ? base.where(eq(sessionThreads.agent_id, agentId))
      : base);
    return rows.map((r) => this._toThread(r));
  }

  // --- Turn ---

  async createTurn(threadId: string): Promise<Turn> {
    const id = crypto.randomUUID();
    const now = Date.now();
    await this.db.insert(sessionTurns).values({
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
      .update(sessionTurns)
      .set(values)
      .where(eq(sessionTurns.id, turnId));
  }

  async getTurn(turnId: string): Promise<Turn | undefined> {
    const rows = await this.db
      .select()
      .from(sessionTurns)
      .where(eq(sessionTurns.id, turnId))
      .limit(1);
    return rows.length === 0 ? undefined : this._toTurn(rows[0]);
  }

  // --- Message ---

  async appendEntry(
    entry: Omit<Message, 'id' | 'createdAt'>,
  ): Promise<Message> {
    const id = crypto.randomUUID();
    const now = Date.now();
    await this.db.insert(sessionMessages).values({
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
      .from(sessionMessages)
      .where(eq(sessionMessages.thread_id, threadId))
      .orderBy(sessionMessages.created_at)
      .offset(start);
    const rows = await (options?.limit ? base.limit(options.limit) : base);
    return rows.map((r) => this._toMessage(r));
  }

  async getRecentEntries(
    threadId: string,
    limit: number,
  ): Promise<Message[]> {
    // 先按 created_at DESC 取 limit 条，再反转顺序（FIFO 窗口按时间正序）
    const rows = await this.db
      .select()
      .from(sessionMessages)
      .where(eq(sessionMessages.thread_id, threadId))
      .orderBy(desc(sessionMessages.created_at))
      .limit(limit);
    return rows.reverse().map((r) => this._toMessage(r));
  }

  // --- Private mappers ---

  private _toThread(r: typeof sessionThreads.$inferSelect): Thread {
    return {
      id: r.id,
      agentId: r.agent_id,
      title: r.title ?? undefined,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

  private _toTurn(r: typeof sessionTurns.$inferSelect): Turn {
    return {
      id: r.id,
      threadId: r.thread_id,
      status: r.status as Turn['status'],
      steps: r.steps,
      createdAt: r.created_at,
    };
  }

  private _toMessage(r: typeof sessionMessages.$inferSelect): Message {
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
      createdAt: r.created_at,
    };
  }
}
