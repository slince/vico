// @vico/checkpoint-mysql — 启动时按 schema 自动建表/更新索引（checkpoint 域）
import { sql } from 'drizzle-orm';
import type { MySql2Database } from 'drizzle-orm/mysql2';

/**
 * 确保 checkpoint 域所有表存在（CREATE TABLE IF NOT EXISTS）。
 * 调用方在应用启动时调用一次即可，幂等安全。
 */
export async function ensureCheckpointTables(
  db: MySql2Database<Record<string, never>>,
): Promise<void> {
  // 迁移检测：旧版 vico_checkpoints 为 (turn_id, version) 复合主键、无 id/parent_id 列。
  // MySQL 无法 ALTER 主键，检测到旧结构时 DROP 重建为版本树（旧链数据开发期丢弃）。
  const ckptCols = await db.execute(sql`
    SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'vico_checkpoints'
  `);
  const ckptColNames = (ckptCols[0] as unknown as Array<{ COLUMN_NAME: string }>).map((r) => r.COLUMN_NAME);
  if (ckptColNames.length > 0 && (!ckptColNames.includes('id') || !ckptColNames.includes('parent_id'))) {
    await db.execute(sql`DROP TABLE vico_checkpoints`);
  }

  // Checkpoints table — 版本树：id 单列主键 + UNIQUE(turn_id, version)
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS vico_checkpoints (
      id VARCHAR(36) PRIMARY KEY,
      parent_id VARCHAR(36),
      turn_id VARCHAR(36) NOT NULL,
      thread_id VARCHAR(36) NOT NULL,
      version INT NOT NULL,
      step_index INT NOT NULL,
      next_action VARCHAR(20) NOT NULL,
      snapshot TEXT NOT NULL,
      created_at BIGINT NOT NULL,
      UNIQUE KEY uq_checkpoints_turn_version (turn_id, version),
      KEY idx_thread_id (thread_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}
