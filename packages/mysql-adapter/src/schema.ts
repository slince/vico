// @vico/mysql-adapter — MySQL Drizzle table definitions for thread and memory persistence
import { mysqlTable, varchar, text, bigint, int, json } from 'drizzle-orm/mysql-core';

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

/** conversation turns */
export const turns = mysqlTable('vico_turns', {
  id: varchar('id', { length: 36 }).primaryKey(),
  thread_id: varchar('thread_id', { length: 36 }).notNull(),
  status: varchar('status', { length: 36 }).notNull().default('running'),
  steps: int('steps').notNull().default(0),
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

/** turn execution state checkpoint, for crash recovery and approval recovery */
export const checkpoints = mysqlTable('vico_checkpoints', {
  id: varchar('id', { length: 36 }).primaryKey(),
  turnId: varchar('turn_id', { length: 36 }).notNull().unique(),
  threadId: varchar('thread_id', { length: 36 }).notNull(),
  version: int('version').notNull().default(1),
  stepIndex: int('step_index').notNull().default(0),
  paused: int('paused').notNull().default(0),
  pendingTool: text('pending_tool'),
  snapshot: text('snapshot').notNull(),
  createdAt: bigint('created_at', { mode: 'number' }).notNull(),
  updatedAt: bigint('updated_at', { mode: 'number' }).notNull(),
});

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
