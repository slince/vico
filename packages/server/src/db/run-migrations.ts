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
export function runMigrations() {
  const db = getDb();
  const migrationsFolder = resolve(__dirname, '../../drizzle');
  try {
    migrate(db, { migrationsFolder });
  } catch (err: any) {
    if (!err.message?.includes('already exists')) {
      throw err;
    }
  }
  logger.info('All migrations applied.');
}
