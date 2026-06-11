import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { config } from '../config.js';
import * as bizSchema from './schema.js';
import * as authSchema from './auth-schema.js';

/** 合并业务表与 better-auth 表，供 Drizzle 实例和外部引用 */
const combinedSchema = { ...bizSchema, ...authSchema };

let drizzleDb: ReturnType<typeof drizzle<typeof combinedSchema>>;
let sqliteDb: Database.Database;

function ensureDir(filePath: string) {
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

/** 获取 Drizzle ORM 实例，用于所有标准 CRUD 操作 */
export function getDb() {
  if (!drizzleDb) {
    ensureDir(config.database.path);
    const sqlite = new Database(config.database.path);
    sqlite.pragma('journal_mode = WAL');
    sqlite.pragma('foreign_keys = ON');
    sqliteDb = sqlite;
    drizzleDb = drizzle(sqlite, { schema: combinedSchema });
  }
  return drizzleDb;
}

/** 获取原始 better-sqlite3 连接，仅用于 BLOB/向量操作 */
export function getSqlite(): Database.Database {
  if (!sqliteDb) {
    getDb(); // 初始化两者
  }
  return sqliteDb;
}

/** 导出合并后的 schema，供路由文件使用 */
export const schema = combinedSchema;

export function closeDb(): void {
  if (sqliteDb) {
    sqliteDb.close();
  }
}
