// @vico/mysql-adapter — MySQL/Drizzle-backed ThreadStore implementation
import { eq, desc } from 'drizzle-orm';
import type { MySql2Database } from 'drizzle-orm/mysql2';
import type { ThreadStore, Thread, Turn, Message } from '@vico/agent';
import {
  threads,
  turns,
  messages,
} from './schema.js';
import type * as schema from './schema.js';

/** DrizzleThreadStore construction options */
export interface DrizzleThreadStoreOptions {
  /** Drizzle MySQL database instance (schema must include this package's tables) */
  db: MySql2Database<typeof schema>;
}

/**
 * MySQL/Drizzle-based ThreadStore.
 * No tenant filtering; suitable for single-tenant scenarios.
 * Multi-tenant scenarios should wrap with WHERE tenant_id externally.
 */
export class DrizzleThreadStore implements ThreadStore {
  private db: MySql2Database<typeof schema>;

  constructor(options: DrizzleThreadStoreOptions) {
    this.db = options.db;
  }

  // --- Thread ---

  async createThread(agentId: string, title?: string): Promise<Thread> {
    const id = crypto.randomUUID();
    const now = Date.now();
    await this.db.insert(threads).values({
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
      .from(threads)
      .where(eq(threads.id, threadId))
      .limit(1);
    return rows.length === 0 ? undefined : this._toThread(rows[0]);
  }

  async listThreads(agentId?: string): Promise<Thread[]> {
    const base = this.db
      .select()
      .from(threads)
      .orderBy(desc(threads.updated_at));
    const rows = await (agentId
      ? base.where(eq(threads.agent_id, agentId))
      : base);
    return rows.map((r) => this._toThread(r));
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
      tool_calls: entry.toolCalls,
      tool_results: entry.toolResults,
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

  async getRecentEntries(
    threadId: string,
    limit: number,
  ): Promise<Message[]> {
    // First take `limit` rows by created_at DESC, then reverse order
    // (FIFO window in chronological order)
    const rows = await this.db
      .select()
      .from(messages)
      .where(eq(messages.thread_id, threadId))
      .orderBy(desc(messages.created_at))
      .limit(limit);
    return rows.reverse().map((r) => this._toMessage(r));
  }

  // --- Private mappers ---

  private _toThread(r: typeof threads.$inferSelect): Thread {
    return {
      id: r.id,
      agentId: r.agent_id,
      title: r.title ?? undefined,
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
      toolCalls: r.tool_calls as unknown,
      toolResults: r.tool_results as unknown,
      createdAt: r.created_at,
    };
  }
}
