// @vico/memory-libsql — Drizzle table definitions for memory persistence
import { sqliteTable, text, integer, blob } from 'drizzle-orm/sqlite-core';

// --- Memory tables ---

/**
 * 记忆条目 — semantic / episodic / knowledge 共享表，通过 `type` 列分义。
 *
 * `scope_type` 列的含义由 `type` 决定（详见 @vico/memory 的 constants.ts）：
 * - `type='semantic'`：`scope_type` 为作用域维度（'user'），`scope_id` 为 userId。
 * - `type='episodic'`：`scope_type` 为向量索引名（情景记忆 'episodic'），`scope_id` 为 userId。
 * - `type='knowledge'`：`scope_type` 为 RAG 向量索引名（kb 索引名），`scope_id` 为 kbId。
 */
export const memoryEntries = sqliteTable('vico_memory_entries', {
  id: text('id').primaryKey(),
  thread_id: text('thread_id'),
  /** 作用域维度（semantic）或向量索引名（episodic/knowledge），见上表契约 */
  scope_type: text('scope_type').notNull(),
  /** 作用域标识（userId / kbId） */
  scope_id: text('scope_id').notNull(),
  /** 'semantic' | 'episodic' | 'knowledge' */
  type: text('type').notNull(),
  content: text('content').notNull(),
  /** F32_BLOB 向量 */
  embedding: blob('embedding'),
  /** JSON 对象文本，默认 '{}' */
  metadata: text('metadata').notNull().default('{}'),
  importance: integer('importance').notNull().default(0),
  created_at: integer('created_at').notNull(),
});
