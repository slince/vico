// @vico/libsql-adapter — 启动时按 schema 自动建表/更新索引
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
 * import { ensureTables } from '@vico/libsql-adapter';
 * await ensureTables(db); // 启动时调用一次
 * ```
 */
export async function ensureTables(
  db: LibSQLDatabase<typeof schema>,
): Promise<void> {
  // 会话线程表
  await db.run(sql`
    CREATE TABLE IF NOT EXISTS vico_threads (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      user_id TEXT,
      title TEXT,
      metadata TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);

  // 对话轮次表
  await db.run(sql`
    CREATE TABLE IF NOT EXISTS vico_turns (
      id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'running',
      steps INTEGER NOT NULL DEFAULT 0,
      metadata TEXT,
      forked_from TEXT,
      created_at INTEGER NOT NULL
    )
  `);

  // 消息表（content 存原生 ModelMessage.content JSON；不兼容旧库，重建即可）
  await db.run(sql`
    CREATE TABLE IF NOT EXISTS vico_messages (
      id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      turn_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      metadata TEXT,
      created_at INTEGER NOT NULL
    )
  `);

  await db.run(sql`
    CREATE INDEX IF NOT EXISTS idx_msg_thread
    ON vico_messages(thread_id)
  `);

  // 迁移检测：旧版 vico_checkpoints 为单列主键 id + turn_id UNIQUE 单行制。
  // SQLite 无法 ALTER 复合主键，检测到旧结构时 DROP 重建为多版本链（旧单行数据开发期丢弃）。
  const ckptCols = await db.values<[string]>(sql`
    SELECT name FROM pragma_table_info('vico_checkpoints')
  `);
  const ckptColNames = ckptCols.map((r) => r[0]);
  if (ckptColNames.length > 0 && !ckptColNames.includes('next_action')) {
    await db.run(sql`DROP TABLE vico_checkpoints`);
  }

  // 检查点多版本链表
  await db.run(sql`
    CREATE TABLE IF NOT EXISTS vico_checkpoints (
      turn_id TEXT NOT NULL,
      thread_id TEXT NOT NULL,
      version INTEGER NOT NULL,
      step_index INTEGER NOT NULL,
      next_action TEXT NOT NULL,
      snapshot TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (turn_id, version)
    )
  `);

  await db.run(sql`
    CREATE INDEX IF NOT EXISTS idx_checkpoints_thread_id
    ON vico_checkpoints(thread_id)
  `);

  // 记忆条目表 — embedding 使用 libsql 原生 F32_BLOB 向量类型
  await db.run(sql`
    CREATE TABLE IF NOT EXISTS vico_memory_entries (
      id TEXT PRIMARY KEY,
      thread_id TEXT,
      scope_type TEXT NOT NULL,
      scope_id TEXT NOT NULL,
      type TEXT NOT NULL,
      content TEXT NOT NULL,
      embedding F32_BLOB(1536),
      metadata TEXT NOT NULL DEFAULT '{}',
      importance INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    )
  `);

  await db.run(sql`
    CREATE INDEX IF NOT EXISTS idx_me_scope
    ON vico_memory_entries(scope_type, scope_id, type)
  `);

  await db.run(sql`
    CREATE INDEX IF NOT EXISTS idx_me_type_imp
    ON vico_memory_entries(type, importance)
  `);

  await db.run(sql`
    CREATE INDEX IF NOT EXISTS idx_me_thread
    ON vico_memory_entries(thread_id)
  `);
}
