// @vico/checkpoint-libsql — Drizzle table definitions for checkpoint persistence
import { sqliteTable, text, integer, index, uniqueIndex } from 'drizzle-orm/sqlite-core';

// --- Checkpoints ---

/** turn 执行状态检查点 — 版本树：id 单列主键 + UNIQUE(turn_id, version)，一行一个版本快照，parent_id 表达血缘 */
export const checkpoints = sqliteTable('vico_checkpoints', {
  id: text('id').primaryKey(),
  parentId: text('parent_id'),
  turnId: text('turn_id').notNull(),
  threadId: text('thread_id').notNull(),
  version: integer('version').notNull(),
  stepIndex: integer('step_index').notNull(),
  nextAction: text('next_action').notNull(),
  snapshot: text('snapshot').notNull(),
  createdAt: integer('created_at').notNull(),
}, (t) => ({
  uniqTurnVersion: uniqueIndex('uniq_checkpoints_turn_version').on(t.turnId, t.version),
}));

// --- Indexes ---

export const checkpointsThreadIdIdx = index('idx_checkpoints_thread_id').on(checkpoints.threadId);
