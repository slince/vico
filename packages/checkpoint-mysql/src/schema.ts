// @vico/checkpoint-mysql — MySQL Drizzle table definitions for checkpoint persistence
import { mysqlTable, varchar, text, bigint, int, uniqueIndex } from 'drizzle-orm/mysql-core';

// --- Checkpoints ---

/** turn 执行状态检查点 — 版本树：id 单列主键 + UNIQUE(turn_id, version)，parent_id 表达血缘 */
export const checkpoints = mysqlTable('vico_checkpoints', {
  id: varchar('id', { length: 36 }).primaryKey(),
  parentId: varchar('parent_id', { length: 36 }),
  turnId: varchar('turn_id', { length: 36 }).notNull(),
  threadId: varchar('thread_id', { length: 36 }).notNull(),
  version: int('version').notNull(),
  stepIndex: int('step_index').notNull(),
  nextAction: varchar('next_action', { length: 20 }).notNull(),
  snapshot: text('snapshot').notNull(),
  createdAt: bigint('created_at', { mode: 'number' }).notNull(),
}, (t) => ({
  uniqTurnVersion: uniqueIndex('uniq_checkpoints_turn_version').on(t.turnId, t.version),
}));
