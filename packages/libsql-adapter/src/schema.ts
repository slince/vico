// @vico/libsql-adapter — Drizzle table definitions for thread and memory persistence
import { sqliteTable, text, integer, blob, index } from 'drizzle-orm/sqlite-core';

// --- Thread tables ---

/** 会话线程 */
export const threads = sqliteTable('vico_threads', {
  id: text('id').primaryKey(),
  agent_id: text('agent_id').notNull(),
  user_id: text('user_id'),
  title: text('title'),
  metadata: text('metadata'),
  created_at: integer('created_at').notNull(),
  updated_at: integer('updated_at').notNull(),
});

/** 对话轮次 */
export const turns = sqliteTable('vico_turns', {
  id: text('id').primaryKey(),
  thread_id: text('thread_id').notNull(),
  status: text('status').notNull().default('running'),
  steps: integer('steps').notNull().default(0),
  metadata: text('metadata'),
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
  created_at: integer('created_at').notNull(),
});

// --- Checkpoints ---

/** turn 执行状态检查点，用于崩溃恢复和审批恢复 */
export const checkpoints = sqliteTable('vico_checkpoints', {
  id: text('id').primaryKey(),
  turnId: text('turn_id').notNull().unique(),
  threadId: text('thread_id').notNull(),
  version: integer('version').notNull().default(1),
  stepIndex: integer('step_index').notNull().default(0),
  paused: integer('paused').notNull().default(0),
  pendingTool: text('pending_tool'),
  snapshot: text('snapshot').notNull(),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

// --- Memory tables ---

/**
 * 记忆条目 — working 和 semantic 共享表，通过 `type` 列分义。
 *
 * `scope_type` 列的含义由 `type` 决定（详见 @vico/core 的 memory/constants.ts）：
 * - `type='working'`：`scope_type` 为作用域维度（'user'），`scope_id` 为 userId。
 * - `type='semantic'`：`scope_type` 为向量索引名（语义记忆 'memory'，RAG 为 kb 索引名），
 *   `scope_id` 为该向量的归属标识（语义记忆为 userId）。
 */
export const memoryEntries = sqliteTable('vico_memory_entries', {
  id: text('id').primaryKey(),
  thread_id: text('thread_id'),
  /** 作用域维度（working）或向量索引名（semantic），见上表契约 */
  scope_type: text('scope_type').notNull(),
  /** 作用域标识（userId / kbId） */
  scope_id: text('scope_id').notNull(),
  /** 'working' | 'semantic' */
  type: text('type').notNull(),
  content: text('content').notNull(),
  /** F32_BLOB 向量 */
  embedding: blob('embedding'),
  /** JSON 对象文本，默认 '{}' */
  metadata: text('metadata').notNull().default('{}'),
  importance: integer('importance').notNull().default(0),
  created_at: integer('created_at').notNull(),
});

// --- Indexes ---

export const checkpointsThreadIdIdx = index('idx_thread_id').on(checkpoints.threadId);
export const checkpointsCreatedAtIdx = index('idx_created_at').on(checkpoints.createdAt);
