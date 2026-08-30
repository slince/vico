// @vico/mysql-adapter — MySQL Drizzle table definitions for thread and memory persistence
import { mysqlTable, varchar, text, bigint, int, json, primaryKey } from 'drizzle-orm/mysql-core';

// --- Thread tables ---

/** threads */
export const threads = mysqlTable('vico_threads', {
  id: varchar('id', { length: 36 }).primaryKey(),
  agent_id: varchar('agent_id', { length: 36 }).notNull(),
  user_id: varchar('user_id', { length: 36 }),
  title: text('title'),
  metadata: json('metadata'),
  created_at: bigint('created_at', { mode: 'number' }).notNull(),
  updated_at: bigint('updated_at', { mode: 'number' }).notNull(),
});

/** conversation turns（新增 forked_from 列：分叉来源） */
export const turns = mysqlTable('vico_turns', {
  id: varchar('id', { length: 36 }).primaryKey(),
  thread_id: varchar('thread_id', { length: 36 }).notNull(),
  status: varchar('status', { length: 36 }).notNull().default('running'),
  steps: int('steps').notNull().default(0),
  /** 本 turn 由源 turn 的某版本分叉而来（JSON 序列化的 {turnId, version}） */
  forked_from: text('forked_from'),
  created_at: bigint('created_at', { mode: 'number' }).notNull(),
});

/** messages — content 存原生 ModelMessage.content 的 JSON 序列化 */
export const messages = mysqlTable('vico_messages', {
  id: varchar('id', { length: 36 }).primaryKey(),
  thread_id: varchar('thread_id', { length: 36 }).notNull(),
  turn_id: varchar('turn_id', { length: 36 }).notNull(),
  role: varchar('role', { length: 36 }).notNull(),
  content: text('content').notNull(),
  metadata: json('metadata'),
  created_at: bigint('created_at', { mode: 'number' }).notNull(),
});

// --- Checkpoints ---

/** turn 执行状态检查点 — 多版本链：(turn_id, version) 复合主键，一行一个版本快照 */
export const checkpoints = mysqlTable('vico_checkpoints', {
  turnId: varchar('turn_id', { length: 36 }).notNull(),
  threadId: varchar('thread_id', { length: 36 }).notNull(),
  version: int('version').notNull(),
  stepIndex: int('step_index').notNull(),
  nextAction: varchar('next_action', { length: 20 }).notNull(),
  snapshot: text('snapshot').notNull(),
  createdAt: bigint('created_at', { mode: 'number' }).notNull(),
}, (t) => ({
  pk: primaryKey({ columns: [t.turnId, t.version] }),
}));

// --- Memory tables ---

/**
 * memory entries — working and semantic share table, distinguished by `type` field.
 *
 * `scope_type` column meaning depends on `type` (see @vico/core memory/constants.ts):
 * - `type='working'`: `scope_type` is the scope dimension ('user'), `scope_id` is userId.
 * - `type='semantic'`: `scope_type` is the vector index name (semantic memory 'memory', RAG kb index name),
 *   `scope_id` is the vector owner id (userId for semantic memory).
 */
export const memoryEntries = mysqlTable('vico_memory_entries', {
  id: varchar('id', { length: 255 }).primaryKey(),
  thread_id: varchar('thread_id', { length: 36 }),
  /** scope dimension (working) or vector index name (semantic), see table contract above */
  scope_type: varchar('scope_type', { length: 36 }).notNull(),
  /** scope identifier (userId / kbId) */
  scope_id: varchar('scope_id', { length: 36 }).notNull(),
  /** 'working' | 'semantic' */
  type: varchar('type', { length: 36 }).notNull(),
  content: text('content').notNull(),
  /** JSON array, e.g. [0.1, 0.2, ...] */
  embedding: json('embedding'),
  /** JSON object, default {} */
  metadata: json('metadata').notNull().default({}),
  importance: int('importance').notNull().default(0),
  created_at: bigint('created_at', { mode: 'number' }).notNull(),
});
