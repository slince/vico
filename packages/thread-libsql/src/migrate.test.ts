import { describe, expect, it } from 'vitest';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { ensureThreadTables } from './migrate.js';
import { turns } from './schema.js';

function makeDb() {
  const client = createClient({ url: ':memory:' });
  const db = drizzle(client, { schema: { turns } });
  return { client, db };
}

describe('ensureThreadTables（turns 迁移）', () => {
  it('存量 vico_turns 无 forked_from：幂等补列', async () => {
    const { client, db } = makeDb();
    // 先建旧结构 turns（无 forked_from）
    await client.execute(`CREATE TABLE vico_turns (
      id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'running',
      steps INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    )`);
    await ensureThreadTables(db as never);
    const cols = (await client.execute('PRAGMA table_info(vico_turns)')).rows.map((r) => String(r.name));
    expect(cols).toContain('forked_from');
  });
});
