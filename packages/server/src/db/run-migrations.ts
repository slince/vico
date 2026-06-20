import { migrate } from 'drizzle-orm/libsql/migrator';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDb } from './db.js';
import logger from '../lib/logger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Run Drizzle migrations.
 * Imports from index.ts — does not auto-execute.
 */
export async function runMigrations() {
  const db = getDb();
  const migrationsFolder = resolve(__dirname, '../../drizzle');
  try {
    await migrate(db, { migrationsFolder });
  } catch (err: any) {
    const msg = err?.message ?? '';
    // 忽略已存在的表/列（幂等迁移）
    if (!msg.includes('already exists') && !msg.includes('duplicate column name')) {
      throw err;
    }
    logger.warn({ msg }, 'Migration skipped (already applied)');
  }
  logger.info('All migrations applied.');
}
