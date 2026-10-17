// @vico/memory-mysql — 启动时按 schema 自动建表/更新索引（memory 域）
import { sql } from 'drizzle-orm';
import type { MySql2Database } from 'drizzle-orm/mysql2';

/**
 * 确保 memory 域所有表存在（CREATE TABLE IF NOT EXISTS）。
 * 调用方在应用启动时调用一次即可，幂等安全。
 */
export async function ensureMemoryTables(
  db: MySql2Database<Record<string, never>>,
): Promise<void> {
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

  // 迁移：记忆类型重命名（working→semantic 画像，semantic 向量→episodic 情景 / knowledge RAG）。
  // 幂等 UPDATE，仅命中存量旧值，新库无匹配行时为零影响。
  await db.execute(sql`UPDATE vico_memory_entries SET type = 'semantic' WHERE type = 'working'`);
  await db.execute(sql`UPDATE vico_memory_entries SET type = 'episodic', scope_type = 'episodic' WHERE type = 'semantic' AND scope_type = 'memory'`);
  await db.execute(sql`UPDATE vico_memory_entries SET type = 'knowledge' WHERE type = 'semantic' AND scope_type LIKE 'kb_%'`);
}
