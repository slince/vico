// @vico/mysql-adapter — Auto-create tables/indexes on startup from schema
import { sql } from 'drizzle-orm';
import type { MySql2Database } from 'drizzle-orm/mysql2';
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
 * import { ensureTables } from '@vico/mysql-adapter';
 * await ensureTables(db); // call once at startup
 * ```
 */
export async function ensureTables(
  db: MySql2Database<typeof schema>,
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
      created_at BIGINT NOT NULL,
      KEY idx_msg_thread (thread_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  // 迁移检测：旧版 vico_checkpoints 为单行制（id PK + turn_id UNIQUE + 无 next_action）。
  // MySQL 无法 ALTER 复合主键，检测到旧结构时 DROP 重建为多版本链（旧单行数据开发期丢弃）。
  const ckptCols = await db.execute(sql`
    SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'vico_checkpoints'
  `);
  const ckptColNames = (ckptCols[0] as unknown as Array<{ COLUMN_NAME: string }>).map((r) => r.COLUMN_NAME);
  if (ckptColNames.length > 0 && !ckptColNames.includes('next_action')) {
    await db.execute(sql`DROP TABLE vico_checkpoints`);
  }

  // Checkpoints table — 多版本链：(turn_id, version) 复合主键，一行一个版本快照
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS vico_checkpoints (
      turn_id VARCHAR(36) NOT NULL,
      thread_id VARCHAR(36) NOT NULL,
      version INT NOT NULL,
      step_index INT NOT NULL,
      next_action VARCHAR(20) NOT NULL,
      snapshot TEXT NOT NULL,
      created_at BIGINT NOT NULL,
      PRIMARY KEY (turn_id, version),
      KEY idx_thread_id (thread_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  // Memory entries table
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS vico_memory_entries (
      id VARCHAR(255) PRIMARY KEY,
      thread_id VARCHAR(36),
      scope_type VARCHAR(36) NOT NULL,
      scope_id VARCHAR(36) NOT NULL,
      type VARCHAR(36) NOT NULL,
      content TEXT NOT NULL,
      embedding JSON,
      metadata JSON NOT NULL,
      importance INT NOT NULL DEFAULT 0,
      created_at BIGINT NOT NULL,
      KEY idx_me_scope (scope_type, scope_id, type),
      KEY idx_me_type_imp (type, importance),
      KEY idx_me_thread (thread_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}
