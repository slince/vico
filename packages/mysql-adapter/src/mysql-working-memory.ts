// @vico/mysql-adapter — MySQL/Drizzle-backed WorkingMemory implementation
import { eq, and } from 'drizzle-orm';
import type { MySql2Database } from 'drizzle-orm/mysql2';
import { DEFAULT_WORKING_MEMORY_TEMPLATE, type WorkingMemory } from '@vico/core';
import { memoryEntries } from './schema.js';
import type * as schema from './schema.js';

/** MysqlWorkingMemory construction options */
export interface MysqlWorkingMemoryOptions {
  /** Drizzle MySQL database instance (schema must include this package's tables) */
  db: MySql2Database<typeof schema>;
  /** Markdown template, uses default template if not provided */
  template?: string;
}

/** MySQL-based working memory implementation — one row per user */
export class MysqlWorkingMemory implements WorkingMemory {
  private db: MySql2Database<typeof schema>;
  private template: string;

  constructor(options: MysqlWorkingMemoryOptions) {
    this.db = options.db;
    this.template = options.template ?? DEFAULT_WORKING_MEMORY_TEMPLATE;
  }

  async get(scopeId: string): Promise<string> {
    const rows = await this.db
      .select({ content: memoryEntries.content })
      .from(memoryEntries)
      .where(
        and(
          eq(memoryEntries.scope_type, 'user'),
          eq(memoryEntries.scope_id, scopeId),
          eq(memoryEntries.type, 'working'),
        ),
      )
      .limit(1);
    return rows.length > 0 ? rows[0].content : '';
  }

  async set(scopeId: string, content: string): Promise<void> {
    // Use deterministic id for upsert (INSERT … ON DUPLICATE KEY UPDATE)
    const id = `user:${scopeId}:working`;
    const now = Date.now();

    await this.db
      .insert(memoryEntries)
      .values({
        id,
        thread_id: null,
        scope_type: 'user',
        scope_id: scopeId,
        type: 'working',
        content,
        embedding: null,
        metadata: {},
        importance: 0,
        created_at: now,
      })
      .onDuplicateKeyUpdate({
        set: { content, created_at: now },
      });
  }

  getTemplate(): string {
    return this.template;
  }
}
