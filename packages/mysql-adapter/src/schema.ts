// @vico/mysql-adapter — MySQL Drizzle table definitions for thread and memory persistence
import { mysqlTable, varchar, text, bigint, int, json, index } from 'drizzle-orm/mysql-core';

// --- Thread tables ---

/** threads */
export const threads = mysqlTable('vico_threads', {
  id: varchar('id', { length: 36 }).primaryKey(),
  agent_id: varchar('agent_id', { length: 36 }).notNull(),
  title: text('title'),
  created_at: bigint('created_at', { mode: 'number' }).notNull(),
  updated_at: bigint('updated_at', { mode: 'number' }).notNull(),
});

/** conversation turns */
export const turns = mysqlTable('vico_turns', {
  id: varchar('id', { length: 36 }).primaryKey(),
  thread_id: varchar('thread_id', { length: 36 })
    .notNull()
    .references(() => threads.id, { onDelete: 'cascade' }),
  status: varchar('status', { length: 36 }).notNull().default('running'),
  steps: int('steps').notNull().default(0),
  created_at: bigint('created_at', { mode: 'number' }).notNull(),
});

/** messages */
export const messages = mysqlTable(
  'vico_messages',
  {
    id: varchar('id', { length: 36 }).primaryKey(),
    thread_id: varchar('thread_id', { length: 36 })
      .notNull()
      .references(() => threads.id, { onDelete: 'cascade' }),
    turn_id: varchar('turn_id', { length: 36 })
      .notNull()
      .references(() => turns.id, { onDelete: 'cascade' }),
    role: varchar('role', { length: 36 }).notNull(),
    content: text('content').notNull(),
    tool_call_id: varchar('tool_call_id', { length: 255 }),
    tool_calls: json('tool_calls'),
    tool_results: json('tool_results'),
    created_at: bigint('created_at', { mode: 'number' }).notNull(),
  },
  (table) => ({
    threadIdx: index('idx_msg_thread').on(table.thread_id),
  }),
);

// --- Memory tables ---

/** memory entries — working and semantic share table, distinguished by type field */
export const memoryEntries = mysqlTable(
  'vico_memory_entries',
  {
    id: varchar('id', { length: 255 }).primaryKey(),
    thread_id: varchar('thread_id', { length: 36 }),
    scope_type: varchar('scope_type', { length: 36 }).notNull(),
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
