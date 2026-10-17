// @vico/memory-mysql — MySQL Drizzle table definitions for memory persistence
import { mysqlTable, varchar, text, bigint, int, json } from 'drizzle-orm/mysql-core';

// --- Memory tables ---

/**
 * memory entries — semantic / episodic / knowledge share table, distinguished by `type` field.
 *
 * `scope_type` column meaning depends on `type` (see @vico/memory constants.ts):
 * - `type='semantic'`: `scope_type` is the scope dimension ('user'), `scope_id` is userId.
 * - `type='episodic'`: `scope_type` is the vector index name (episodic memory 'episodic'), `scope_id` is userId.
 * - `type='knowledge'`: `scope_type` is the RAG vector index name (kb index name), `scope_id` is kbId.
 */
export const memoryEntries = mysqlTable('vico_memory_entries', {
  id: varchar('id', { length: 255 }).primaryKey(),
  thread_id: varchar('thread_id', { length: 36 }),
  /** scope dimension (semantic) or vector index name (episodic/knowledge), see table contract above */
  scope_type: varchar('scope_type', { length: 36 }).notNull(),
  /** scope identifier (userId / kbId) */
  scope_id: varchar('scope_id', { length: 36 }).notNull(),
  /** 'semantic' | 'episodic' | 'knowledge' */
  type: varchar('type', { length: 36 }).notNull(),
  content: text('content').notNull(),
  /** JSON array, e.g. [0.1, 0.2, ...] */
  embedding: json('embedding'),
  /** JSON object, default {} */
  metadata: json('metadata').notNull().default({}),
  importance: int('importance').notNull().default(0),
  created_at: bigint('created_at', { mode: 'number' }).notNull(),
});
