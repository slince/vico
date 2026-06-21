// @vico/libsql-adapter — Drizzle table definitions for session and memory persistence
import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';

// --- Session tables ---

/** 会话线程 */
export const sessionThreads = sqliteTable('session_threads', {
  id: text('id').primaryKey(),
  agent_id: text('agent_id').notNull(),
  title: text('title'),
  created_at: integer('created_at').notNull(),
  updated_at: integer('updated_at').notNull(),
});

/** 对话轮次 */
export const sessionTurns = sqliteTable('session_turns', {
  id: text('id').primaryKey(),
  thread_id: text('thread_id')
    .notNull()
    .references(() => sessionThreads.id, { onDelete: 'cascade' }),
  status: text('status').notNull().default('running'),
  steps: integer('steps').notNull().default(0),
  created_at: integer('created_at').notNull(),
});

/** 消息 */
export const sessionMessages = sqliteTable(
  'session_messages',
  {
    id: text('id').primaryKey(),
    thread_id: text('thread_id')
      .notNull()
      .references(() => sessionThreads.id, { onDelete: 'cascade' }),
    turn_id: text('turn_id')
      .notNull()
      .references(() => sessionTurns.id, { onDelete: 'cascade' }),
    role: text('role').notNull(),
    content: text('content').notNull(),
    tool_call_id: text('tool_call_id'),
    tool_calls: text('tool_calls'),
    tool_results: text('tool_results'),
    created_at: integer('created_at').notNull(),
  },
  (table) => ({
    threadIdx: index('idx_sm_thread').on(table.thread_id),
  }),
);

// --- Memory tables ---

/** 记忆条目 — working 和 semantic 共享表，通过 type 字段区分 */
export const memoryEntries = sqliteTable(
  'memory_entries',
  {
    id: text('id').primaryKey(),
    thread_id: text('thread_id'),
    scope_type: text('scope_type').notNull(),
    scope_id: text('scope_id').notNull(),
    /** 'working' | 'semantic' */
    type: text('type').notNull(),
    content: text('content').notNull(),
    /** JSON 数组文本，如 [0.1, 0.2, ...] */
    embedding: text('embedding'),
    /** JSON 对象文本，默认 '{}' */
    metadata: text('metadata').notNull().default('{}'),
    importance: integer('importance').notNull().default(0),
    created_at: integer('created_at').notNull(),
  },
  (table) => ({
    scopeIdx: index('idx_me_scope').on(
      table.scope_type,
      table.scope_id,
      table.type,
    ),
    typeImpIdx: index('idx_me_type_imp').on(table.type, table.importance),
    threadIdx: index('idx_me_thread').on(table.thread_id),
  }),
);
