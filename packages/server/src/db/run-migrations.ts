import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDb } from './db.js';

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
  console.log('[DB] All migrations applied.');
}
