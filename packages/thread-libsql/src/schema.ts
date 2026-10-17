// @vico/thread-libsql — Drizzle table definitions for thread persistence
import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

// --- Thread tables ---

/** 会话线程 */
export const threads = sqliteTable('vico_threads', {
  id: text('id').primaryKey(),
  agent_id: text('agent_id').notNull(),
  user_id: text('user_id'),
  title: text('title'),
  metadata: text('metadata'),
  /** 是否已归档（软归档；列表/详情均返回该标志） */
  archived: integer('archived', { mode: 'boolean' }).notNull().default(false),
  created_at: integer('created_at').notNull(),
  updated_at: integer('updated_at').notNull(),
});

/** 对话轮次（新增 forked_from 列：分叉来源） */
export const turns = sqliteTable('vico_turns', {
  id: text('id').primaryKey(),
  thread_id: text('thread_id').notNull(),
  status: text('status').notNull().default('running'),
  steps: integer('steps').notNull().default(0),
  metadata: text('metadata'),
  /** 本 turn 由源 turn 的某版本分叉而来（JSON 序列化的 {turnId, version}） */
  forked_from: text('forked_from'),
  created_at: integer('created_at').notNull(),
});

/** 消息 — content 存原生 ModelMessage.content 的 JSON 序列化 */
export const messages = sqliteTable('vico_messages', {
  id: text('id').primaryKey(),
  thread_id: text('thread_id').notNull(),
  turn_id: text('turn_id').notNull(),
  role: text('role').notNull(),
  content: text('content').notNull(),
  metadata: text('metadata'),
  /** 是否已被压缩归档（soft delete；模型上下文不读，UI 全量展示） */
  archived: integer('archived', { mode: 'boolean' }).notNull().default(false),
  created_at: integer('created_at').notNull(),
});
