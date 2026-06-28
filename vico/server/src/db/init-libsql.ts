/**
 * libsql 客户端 + Drizzle ORM 初始化
 * 替代原来的 better-sqlite3 getDb()/getSqlite()
 * Mastra 的 LibSQLStore/LibSQLVector 通过 url 独立连接同一文件
 */
import { createClient, type Client } from '@libsql/client';
import { drizzle, type LibSQLDatabase } from 'drizzle-orm/libsql';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config.js';
import * as bizSchema from './schema.js';
import * as authSchema from './auth-schema.js';

const combinedSchema = { ...bizSchema, ...authSchema };

let _client: Client;
let _db: LibSQLDatabase<typeof combinedSchema>;

/** 确保数据库文件所在目录存在 */
function ensureDbDir(dbUrl: string): void {
  // 提取 file:./data/vico.db 中的本地路径部分
  const match = dbUrl.match(/^file:(.*)$/);
  if (match) {
    const filePath = match[1];
    // 相对路径相对于 server 包根目录解析
    const fromDir = dirname(fileURLToPath(import.meta.url));
    const absoluteDir = dirname(new URL(filePath, `file://${fromDir}/`).pathname);
    mkdirSync(absoluteDir, { recursive: true });
  }
}

/** 获取 libsql 客户端，用于 BLOB/向量等低级操作 */
export function getClient(): Client {
  if (!_client) {
    ensureDbDir(config.database.url);
    _client = createClient({ url: config.database.url });
  }
  return _client;
}

/** 获取 Drizzle ORM 实例（libsql），用于所有标准 CRUD 操作 */
export function getDb(): LibSQLDatabase<typeof combinedSchema> {
  if (!_db) {
    _db = drizzle(getClient(), { schema: combinedSchema });
  }
  return _db;
}

/** 获取数据库连接 URL */
export function getDatabaseUrl(): string {
  return config.database.url;
}

export { combinedSchema as schema };
