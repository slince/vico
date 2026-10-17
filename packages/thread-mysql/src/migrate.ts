// @vico/thread-mysql — 启动时按 schema 自动建表/更新索引（thread/turn/message 域）
import { sql } from 'drizzle-orm';
import type { MySql2Database } from 'drizzle-orm/mysql2';

/**
 * 确保 thread 域所有表存在（CREATE TABLE IF NOT EXISTS）。
 * 调用方在应用启动时调用一次即可，幂等安全。
 *
 * 注意：这仅保证表/索引存在，不处理列变更。
 * 生产环境建议用 drizzle-kit generate + migrate() 管理完整迁移。
 */
export async function ensureThreadTables(
  db: MySql2Database<Record<string, never>>,
): Promise<void> {
  // Threads table
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS vico_threads (
      id VARCHAR(36) PRIMARY KEY,
      agent_id VARCHAR(36) NOT NULL,
      title TEXT,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  // Turns table
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS vico_turns (
      id VARCHAR(36) PRIMARY KEY,
      thread_id VARCHAR(36) NOT NULL,
      status VARCHAR(36) NOT NULL DEFAULT 'running',
      steps INT NOT NULL DEFAULT 0,
      forked_from TEXT,
      created_at BIGINT NOT NULL,
      KEY idx_turns_thread (thread_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  // 迁移检测：存量 vico_turns 无 forked_from 列 → 幂等补列
  const turnCols = await db.execute(sql`
    SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'vico_turns'
  `);
  const turnColNames = (turnCols[0] as unknown as Array<{ COLUMN_NAME: string }>).map((r) => r.COLUMN_NAME);
  if (turnColNames.length > 0 && !turnColNames.includes('forked_from')) {
    await db.execute(sql`ALTER TABLE vico_turns ADD COLUMN forked_from TEXT`);
  }

  // Messages table（content 存原生 ModelMessage.content JSON）
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS vico_messages (
      id VARCHAR(36) PRIMARY KEY,
      thread_id VARCHAR(36) NOT NULL,
      turn_id VARCHAR(36) NOT NULL,
      role VARCHAR(36) NOT NULL,
      content TEXT NOT NULL,
      metadata JSON,
      archived BOOLEAN NOT NULL DEFAULT FALSE,
      created_at BIGINT NOT NULL,
      KEY idx_msg_thread (thread_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  // 迁移检测：存量 vico_messages 无 archived 列 → 幂等补列
  const msgCols = await db.execute(sql`
    SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'vico_messages'
  `);
  const msgColNames = (msgCols[0] as unknown as Array<{ COLUMN_NAME: string }>).map((r) => r.COLUMN_NAME);
  if (msgColNames.length > 0 && !msgColNames.includes('archived')) {
    await db.execute(sql`ALTER TABLE vico_messages ADD COLUMN archived BOOLEAN NOT NULL DEFAULT FALSE`);
  }
}
