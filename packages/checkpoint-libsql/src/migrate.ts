// @vico/checkpoint-libsql — 启动时按 schema 自动建表/更新索引（checkpoint 域）
import {sql} from 'drizzle-orm';
import type {LibSQLDatabase} from 'drizzle-orm/libsql';

/**
 * 确保 checkpoint 域所有表存在（CREATE TABLE IF NOT EXISTS）。
 * 调用方在应用启动时调用一次即可，幂等安全。
 */
export async function ensureCheckpointTables(
  db: LibSQLDatabase<Record<string, never>>,
): Promise<void> {
  // 迁移检测：旧版 vico_checkpoints 为 (turn_id, version) 复合主键、无 id/parent_id 列。
  // SQLite 无法 ALTER 主键，检测到旧结构时 DROP 重建为版本树（旧链数据开发期丢弃）。
  const ckptCols = await db.values<[string]>(sql`
    SELECT name FROM pragma_table_info('vico_checkpoints')
  `);
  const ckptColNames = ckptCols.map((r) => r[0]);
  if (ckptColNames.length > 0 && (!ckptColNames.includes('id') || !ckptColNames.includes('parent_id'))) {
    await db.run(sql`DROP TABLE vico_checkpoints`);
  }

  // 检查点版本树
  await db.run(sql`
    CREATE TABLE IF NOT EXISTS vico_checkpoints (
      id TEXT PRIMARY KEY,
      parent_id TEXT,
      turn_id TEXT NOT NULL,
      thread_id TEXT NOT NULL,
      version INTEGER NOT NULL,
      step_index INTEGER NOT NULL,
      next_action TEXT NOT NULL,
      snapshot TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      UNIQUE (turn_id, version)
    )
  `);

  await db.run(sql`
    CREATE INDEX IF NOT EXISTS idx_checkpoints_thread_id
    ON vico_checkpoints(thread_id)
  `);
}
