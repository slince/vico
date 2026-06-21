// @vico/mysql-adapter — MySQL/Drizzle-backed WorkingMemory implementation
import { eq, and } from 'drizzle-orm';
import type { MySql2Database } from 'drizzle-orm/mysql2';
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

/** DrizzleWorkingMemory construction options */
export interface DrizzleWorkingMemoryOptions {
  /** Drizzle MySQL database instance (schema must include this package's tables) */
  db: MySql2Database<typeof schema>;
  /** Scope, default 'user' */
  scope?: 'user' | 'workspace';
  /** Markdown template, uses default template if not provided */
  template?: string;
}

/** MySQL/Drizzle-based working memory implementation — one row per scope */
export class DrizzleWorkingMemory implements WorkingMemory {
  readonly scope: 'user' | 'workspace';
  private db: MySql2Database<typeof schema>;
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
    // Use deterministic id for upsert (INSERT … ON DUPLICATE KEY UPDATE)
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
