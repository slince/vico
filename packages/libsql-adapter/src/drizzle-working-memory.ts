// @vico/libsql-adapter — Drizzle-backed WorkingMemory implementation
import { eq, and } from 'drizzle-orm';
import type { LibSQLDatabase } from 'drizzle-orm/libsql';
import type { WorkingMemory } from '@vico/agent';
import { memoryEntries } from './schema.js';
import type * as schema from './schema.js';

const DEFAULT_TEMPLATE = `# User Facts
- **Name**:
- **Location**:
- **Time Zone**:
- **Language**:

## Preferences
- **Communication Style**:

## Session Context
- **Current Task**:
`;

/** DrizzleWorkingMemory 构造选项 */
export interface DrizzleWorkingMemoryOptions {
  /** Drizzle LibSQL 数据库实例（schema 需包含本包的表） */
  db: LibSQLDatabase<typeof schema>;
  /** 作用域，默认 'user' */
  scope?: 'user' | 'workspace';
  /** Markdown 模板，未提供时使用默认模板 */
  template?: string;
}

/** 基于 Drizzle + LibSQL 的工作记忆实现 — 每个 scope 一行 */
export class DrizzleWorkingMemory implements WorkingMemory {
  readonly scope: 'user' | 'workspace';
  private db: LibSQLDatabase<typeof schema>;
  private template: string;

  constructor(options: DrizzleWorkingMemoryOptions) {
    this.db = options.db;
    this.scope = options.scope ?? 'user';
    this.template = options.template ?? DEFAULT_TEMPLATE;
  }

  async get(scopeId: string): Promise<string> {
    const rows = await this.db
      .select({ content: memoryEntries.content })
      .from(memoryEntries)
      .where(
        and(
          eq(memoryEntries.scope_type, this.scope),
          eq(memoryEntries.scope_id, scopeId),
          eq(memoryEntries.type, 'working'),
        ),
      )
      .limit(1);
    return rows.length > 0 ? rows[0].content : '';
  }

  async set(scopeId: string, content: string): Promise<void> {
    // 使用确定性 id 实现 upsert（INSERT … ON CONFLICT DO UPDATE）
    const id = `${this.scope}:${scopeId}:working`;
    const now = Date.now();

    await this.db
      .insert(memoryEntries)
      .values({
        id,
        thread_id: null,
        scope_type: this.scope,
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
