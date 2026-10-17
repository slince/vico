// @vico/memory-libsql — 启动时按 schema 自动建表/更新索引（memory 域）
import {sql} from 'drizzle-orm';
import type {LibSQLDatabase} from 'drizzle-orm/libsql';

/**
 * 确保 memory 域所有表存在（CREATE TABLE IF NOT EXISTS）。
 * 调用方在应用启动时调用一次即可，幂等安全。
 *
 * 注意：`vico_memory_entries` 同时承载 semantic（文本）与 episodic/knowledge（向量）行，
 * 向量检索实现（如 @vico/rag-libsql 的 LibSQLVectorStore）也依赖此表存在。
 */
export async function ensureMemoryTables(
  db: LibSQLDatabase<Record<string, never>>,
): Promise<void> {
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
