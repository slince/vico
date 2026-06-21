// @vico/libsql — 启动时按 schema 自动建表/更新索引
import { sql } from 'drizzle-orm';
import type { LibSQLDatabase } from 'drizzle-orm/libsql';
import type * as schema from './schema.js';

/**
 * 确保所有表存在（CREATE TABLE IF NOT EXISTS）。
 * 调用方在应用启动时调用一次即可，幂等安全。
 *
 * 注意：这仅保证表/索引存在，不处理列变更。
 * 生产环境建议用 drizzle-kit generate + migrate() 管理完整迁移。
 *
 * @example
 * ```ts
 * import { ensureTables } from '@vico/libsql';
 * await ensureTables(db); // 启动时调用一次
 * ```
 */
export async function ensureTables(
  db: LibSQLDatabase<typeof schema>,
): Promise<void> {
  // 会话线程表 — 每个对话会话一条记录
  await db.run(sql`
    CREATE TABLE IF NOT EXISTS session_threads (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      title TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);

  // 对话轮次表 — 一次 Agent 交互为一个 turn
  await db.run(sql`
    CREATE TABLE IF NOT EXISTS session_turns (
      id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL REFERENCES session_threads(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'running',
      steps INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    )
  `);

  // 消息表 — 单条对话记录（user/assistant/tool）
  await db.run(sql`
    CREATE TABLE IF NOT EXISTS session_messages (
      id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL REFERENCES session_threads(id) ON DELETE CASCADE,
      turn_id TEXT NOT NULL REFERENCES session_turns(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      tool_call_id TEXT,
      tool_calls TEXT,
      tool_results TEXT,
      created_at INTEGER NOT NULL
    )
  `);

  // 消息按 thread_id 检索索引
  await db.run(sql`
    CREATE INDEX IF NOT EXISTS idx_sm_thread
    ON session_messages(thread_id)
  `);

  // 记忆条目表 — type='working' 为工作记忆，type='semantic' 为语义记忆
  await db.run(sql`
    CREATE TABLE IF NOT EXISTS memory_entries (
      id TEXT PRIMARY KEY,
      thread_id TEXT,
      scope_type TEXT NOT NULL,
      scope_id TEXT NOT NULL,
      type TEXT NOT NULL,
      content TEXT NOT NULL,
      embedding TEXT,
      metadata TEXT NOT NULL DEFAULT '{}',
      importance INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    )
  `);

  // 按 (scope_type, scope_id, type) 检索记忆
  await db.run(sql`
    CREATE INDEX IF NOT EXISTS idx_me_scope
    ON memory_entries(scope_type, scope_id, type)
  `);

  // 按类型 + 重要度排序
  await db.run(sql`
    CREATE INDEX IF NOT EXISTS idx_me_type_imp
    ON memory_entries(type, importance)
  `);

  // 按 thread_id 回溯关联记忆
  await db.run(sql`
    CREATE INDEX IF NOT EXISTS idx_me_thread
    ON memory_entries(thread_id)
  `);
}
