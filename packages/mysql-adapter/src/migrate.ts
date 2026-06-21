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
 * MySQL 不支持 CREATE INDEX IF NOT EXISTS / ALTER TABLE ADD CONSTRAINT IF NOT EXISTS，
 * 外键和索引的幂等通过 catch 对应错误码实现。
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
  // Threads table — one record per conversation thread
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS vico_threads (
      id VARCHAR(36) PRIMARY KEY,
      agent_id VARCHAR(36) NOT NULL,
      title TEXT,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  // Conversation turns table — one Agent interaction = one turn
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS vico_turns (
      id VARCHAR(36) PRIMARY KEY,
      thread_id VARCHAR(36) NOT NULL,
      status VARCHAR(36) NOT NULL DEFAULT 'running',
      steps INT NOT NULL DEFAULT 0,
      created_at BIGINT NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  // Messages table — single conversation record (user/assistant/tool)
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
      created_at BIGINT NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  // Memory entries table — type='working' for working memory,
  // type='semantic' for semantic memory
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
      created_at BIGINT NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  // --- Foreign keys ---

  await _addFKIfNotExists(db, 'vico_turns',
    'fk_turns_thread', 'FOREIGN KEY (thread_id) REFERENCES vico_threads(id) ON DELETE CASCADE');

  await _addFKIfNotExists(db, 'vico_messages',
    'fk_messages_thread', 'FOREIGN KEY (thread_id) REFERENCES vico_threads(id) ON DELETE CASCADE');

  await _addFKIfNotExists(db, 'vico_messages',
    'fk_messages_turn', 'FOREIGN KEY (turn_id) REFERENCES vico_turns(id) ON DELETE CASCADE');

  // --- Indexes ---

  await _addIndexIfNotExists(db, 'vico_messages', 'idx_msg_thread', 'thread_id');

  await _addIndexIfNotExists(db, 'vico_memory_entries', 'idx_me_scope', 'scope_type, scope_id, type');

  await _addIndexIfNotExists(db, 'vico_memory_entries', 'idx_me_type_imp', 'type, importance');

  await _addIndexIfNotExists(db, 'vico_memory_entries', 'idx_me_thread', 'thread_id');
}

/** MySQL error codes for duplicate key/index name */
const ER_DUP_KEYNAME = 1061;
const ER_DUP_KEY = 1022;

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
  }
}

/**
 * 添加外键约束，MySQL 不支持 IF NOT EXISTS，通过 catch ER_DUP_KEY 实现幂等
 */
async function _addFKIfNotExists(
  db: MySql2Database<typeof schema>,
  tableName: string,
  fkName: string,
  fkBody: string,
): Promise<void> {
  try {
    await db.execute(
      sql.raw(
        `ALTER TABLE ${tableName} ADD CONSTRAINT ${fkName} ${fkBody}`,
      ),
    );
  } catch (e: unknown) {
    const err = e as { errno?: number };
    if (err.errno !== ER_DUP_KEY) throw e;
  }
}
