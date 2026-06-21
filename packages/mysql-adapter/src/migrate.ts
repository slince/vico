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
      created_at BIGINT NOT NULL,
      KEY idx_turns_thread (thread_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  // Messages table
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS vico_messages (
      id VARCHAR(36) PRIMARY KEY,
      thread_id VARCHAR(36) NOT NULL,
      turn_id VARCHAR(36) NOT NULL,
      role VARCHAR(36) NOT NULL,
      content TEXT NOT NULL,
      tool_call_id VARCHAR(255),
      tool_calls JSON,
      tool_results JSON,
      created_at BIGINT NOT NULL,
      KEY idx_msg_thread (thread_id)
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
