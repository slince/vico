// @vico/thread-libsql — 启动时按 schema 自动建表/更新索引（thread/turn/message 域）
import {sql} from 'drizzle-orm';
import type {LibSQLDatabase} from 'drizzle-orm/libsql';

/**
 * 确保 thread 域所有表存在（CREATE TABLE IF NOT EXISTS）。
 * 调用方在应用启动时调用一次即可，幂等安全。
 *
 * 注意：这仅保证表/索引存在，不处理列变更。
 * 生产环境建议用 drizzle-kit generate + migrate() 管理完整迁移。
 */
export async function ensureThreadTables(
  db: LibSQLDatabase<Record<string, never>>,
): Promise<void> {
  // 会话线程表
  await db.run(sql`
    CREATE TABLE IF NOT EXISTS vico_threads (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      user_id TEXT,
      title TEXT,
      metadata TEXT,
      archived INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);

  // 迁移检测：存量 vico_threads 无 archived 列 → 幂等补列（软归档支持）
  const threadCols = await db.values<[string]>(sql`
    SELECT name FROM pragma_table_info('vico_threads')
  `);
  const threadColNames = threadCols.map((r) => r[0]);
  if (threadColNames.length > 0 && !threadColNames.includes('archived')) {
    await db.run(sql`ALTER TABLE vico_threads ADD COLUMN archived INTEGER NOT NULL DEFAULT 0`);
  }

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

  // 迁移检测：存量 vico_turns 无 forked_from 列 → 幂等补列（新库 CREATE 已含，此处只处理存量库）。
  // 缺失该列时 LibSqlThreadStore 读写 forked_from 会 "no such column"，应用硬崩。
  const turnCols = await db.values<[string]>(sql`
    SELECT name FROM pragma_table_info('vico_turns')
  `);
  const turnColNames = turnCols.map((r) => r[0]);
  if (turnColNames.length > 0 && !turnColNames.includes('forked_from')) {
    await db.run(sql`ALTER TABLE vico_turns ADD COLUMN forked_from TEXT`);
  }

  // 消息表（content 存原生 ModelMessage.content JSON；不兼容旧库，重建即可）
  await db.run(sql`
    CREATE TABLE IF NOT EXISTS vico_messages (
      id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      turn_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      metadata TEXT,
      archived INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    )
  `);

  await db.run(sql`
    CREATE INDEX IF NOT EXISTS idx_msg_thread
    ON vico_messages(thread_id)
  `);

  // 迁移检测：存量 vico_messages 无 archived 列 → 幂等补列
  const msgCols = await db.values<[string]>(sql`
    SELECT name FROM pragma_table_info('vico_messages')
  `);
  const msgColNames = msgCols.map((r) => r[0]);
  if (msgColNames.length > 0 && !msgColNames.includes('archived')) {
    await db.run(sql`ALTER TABLE vico_messages ADD COLUMN archived INTEGER NOT NULL DEFAULT 0`);
  }
}
