// @vico/mysql-adapter — Auto-create tables/indexes on startup from schema
import { sql } from 'drizzle-orm';
import type { MySql2Database } from 'drizzle-orm/mysql2';
import type * as schema from './schema.js';

/**
 * Ensure all tables exist (CREATE TABLE IF NOT EXISTS).
 * Callers should call this once at application startup; idempotent and safe.
 *
 * Note: This only guarantees table/index existence; it does NOT handle
 * column changes. Production environments should use drizzle-kit generate
 * + migrate() for complete migration management.
 *
 * MySQL does not support CREATE INDEX IF NOT EXISTS, so index creation
 * catches ER_DUP_KEYNAME (error 1061) to keep the call idempotent.
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
  // Session threads table — one record per conversation session
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS session_threads (
      id VARCHAR(36) PRIMARY KEY,
      agent_id VARCHAR(36) NOT NULL,
      title TEXT,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  // Conversation turns table — one Agent interaction = one turn
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS session_turns (
      id VARCHAR(36) PRIMARY KEY,
      thread_id VARCHAR(36) NOT NULL,
      status VARCHAR(36) NOT NULL DEFAULT 'running',
      steps INT NOT NULL DEFAULT 0,
      created_at BIGINT NOT NULL,
      FOREIGN KEY (thread_id) REFERENCES session_threads(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  // Messages table — single conversation record (user/assistant/tool)
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS session_messages (
      id VARCHAR(36) PRIMARY KEY,
      thread_id VARCHAR(36) NOT NULL,
      turn_id VARCHAR(36) NOT NULL,
      role VARCHAR(36) NOT NULL,
      content TEXT NOT NULL,
      tool_call_id VARCHAR(255),
      tool_calls JSON,
      tool_results JSON,
      created_at BIGINT NOT NULL,
      FOREIGN KEY (thread_id) REFERENCES session_threads(id) ON DELETE CASCADE,
      FOREIGN KEY (turn_id) REFERENCES session_turns(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  // Index for message retrieval by thread_id
  await _addIndexIfNotExists(
    db,
    'session_messages',
    'idx_sm_thread',
    'thread_id',
  );

  // Memory entries table — type='working' for working memory,
  // type='semantic' for semantic memory
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS memory_entries (
      id VARCHAR(255) PRIMARY KEY,
      thread_id VARCHAR(36),
      scope_type VARCHAR(36) NOT NULL,
      scope_id VARCHAR(36) NOT NULL,
      type VARCHAR(36) NOT NULL,
      content TEXT NOT NULL,
      embedding JSON,
      metadata JSON NOT NULL,
      importance INT NOT NULL DEFAULT 0,
      created_at BIGINT NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  // Index for memory retrieval by (scope_type, scope_id, type)
  await _addIndexIfNotExists(
    db,
    'memory_entries',
    'idx_me_scope',
    'scope_type, scope_id, type',
  );

  // Index for ordering by type + importance
  await _addIndexIfNotExists(
    db,
    'memory_entries',
    'idx_me_type_imp',
    'type, importance',
  );

  // Index for tracing associated memory by thread_id
  await _addIndexIfNotExists(
    db,
    'memory_entries',
    'idx_me_thread',
    'thread_id',
  );
}

/** MySQL error code for duplicate index / key name */
const ER_DUP_KEYNAME = 1061;

/**
 * 创建索引，MySQL 不支持 IF NOT EXISTS，通过 catch ER_DUP_KEYNAME 实现幂等
 */
async function _addIndexIfNotExists(
  db: MySql2Database<typeof schema>,
  tableName: string,
  indexName: string,
  indexColumns: string,
): Promise<void> {
  try {
    await db.execute(
      sql.raw(
        `CREATE INDEX ${indexName} ON ${tableName} (${indexColumns})`,
      ),
    );
  } catch (e: unknown) {
    const err = e as { errno?: number };
    if (err.errno !== ER_DUP_KEYNAME) throw e;
    // Index already exists — silently skip
  }
}
