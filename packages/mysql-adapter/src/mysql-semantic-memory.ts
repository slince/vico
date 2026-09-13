// @vico/mysql-adapter — MySQL/Drizzle-backed SemanticMemory implementation
import { eq, and } from 'drizzle-orm';
import type { MySql2Database } from 'drizzle-orm/mysql2';
import {
  DEFAULT_SEMANTIC_MEMORY_TEMPLATE,
  MEMORY_ENTRY_TYPE,
  SEMANTIC_MEMORY_SCOPE_TYPE,
  type SemanticMemory,
} from '@vico/core';
import { memoryEntries } from './schema.js';
import type * as schema from './schema.js';

/** MysqlSemanticMemory construction options */
export interface MysqlSemanticMemoryOptions {
  /** Drizzle MySQL database instance (schema must include this package's tables) */
  db: MySql2Database<typeof schema>;
  /** Markdown template, uses default template if not provided */
  template?: string;
}

/** MySQL-based semantic memory implementation — one row per user */
export class MysqlSemanticMemory implements SemanticMemory {
  private db: MySql2Database<typeof schema>;
  private template: string;

  constructor(options: MysqlSemanticMemoryOptions) {
    this.db = options.db;
    this.template = options.template ?? DEFAULT_SEMANTIC_MEMORY_TEMPLATE;
  }

  async get(scopeId: string): Promise<string> {
    const rows = await this.db
      .select({ content: memoryEntries.content })
      .from(memoryEntries)
      .where(
        and(
          eq(memoryEntries.scope_type, SEMANTIC_MEMORY_SCOPE_TYPE),
          eq(memoryEntries.scope_id, scopeId),
          eq(memoryEntries.type, MEMORY_ENTRY_TYPE.semantic),
        ),
      )
      .limit(1);
    return rows.length > 0 ? rows[0].content : '';
  }

  async set(scopeId: string, content: string): Promise<void> {
    // Use deterministic id for upsert (INSERT … ON DUPLICATE KEY UPDATE)
    const id = `user:${scopeId}:semantic`;
    const now = Date.now();

    await this.db
      .insert(memoryEntries)
      .values({
        id,
        thread_id: null,
        scope_type: SEMANTIC_MEMORY_SCOPE_TYPE,
        scope_id: scopeId,
        type: MEMORY_ENTRY_TYPE.semantic,
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
