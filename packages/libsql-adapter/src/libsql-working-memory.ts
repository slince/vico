// @vico/libsql-adapter — Drizzle-backed WorkingMemory implementation
import { eq, and } from 'drizzle-orm';
import type { LibSQLDatabase } from 'drizzle-orm/libsql';
import { DEFAULT_WORKING_MEMORY_TEMPLATE, type WorkingMemory } from '@vico/core';
import { memoryEntries } from './schema.js';
import type * as schema from './schema.js';

/** LibSqlWorkingMemory 构造选项 */
export interface LibSqlWorkingMemoryOptions {
  /** Drizzle LibSQL 数据库实例（schema 需包含本包的表） */
  db: LibSQLDatabase<typeof schema>;
  /** Markdown 模板，未提供时使用默认模板 */
  template?: string;
}

/** LibSQL 版工作记忆实现 — 每个用户一行 */
export class LibSqlWorkingMemory implements WorkingMemory {
  private db: LibSQLDatabase<typeof schema>;
  private template: string;

  constructor(options: LibSqlWorkingMemoryOptions) {
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
    // 使用确定性 id 实现 upsert（INSERT … ON CONFLICT DO UPDATE）
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
        metadata: '{}',
        importance: 0,
        created_at: now,
      })
      .onConflictDoUpdate({
        target: memoryEntries.id,
        set: { content, created_at: now },
      });
  }

  getTemplate(): string {
    return this.template;
  }
}
