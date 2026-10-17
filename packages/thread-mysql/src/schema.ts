// @vico/thread-mysql — MySQL Drizzle table definitions for thread persistence
import { mysqlTable, varchar, text, bigint, int, json, boolean } from 'drizzle-orm/mysql-core';

// --- Thread tables ---

/** threads */
export const threads = mysqlTable('vico_threads', {
  id: varchar('id', { length: 36 }).primaryKey(),
  agent_id: varchar('agent_id', { length: 36 }).notNull(),
  user_id: varchar('user_id', { length: 36 }),
  title: text('title'),
  metadata: json('metadata'),
  /** 是否已归档（软归档；列表/详情均返回该标志） */
  archived: boolean('archived').notNull().default(false),
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
  /** 是否已被压缩归档（soft delete；模型上下文不读，UI 全量展示） */
  archived: boolean('archived').notNull().default(false),
  created_at: bigint('created_at', { mode: 'number' }).notNull(),
});
