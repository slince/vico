import { describe, expect, it } from 'vitest';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { ensureTables } from './migrate.js';
import { checkpoints, turns } from './schema.js';

function makeDb() {
  const client = createClient({ url: ':memory:' });
  const db = drizzle(client, { schema: { checkpoints, turns } });
  return { client, db };
}

describe('ensureTables（多版本 checkpoint 表）', () => {
  it('全新库：建出复合主键 + next_action 结构', async () => {
    const { client, db } = makeDb();
    await ensureTables(db as any);
    const pkRows = await client.execute("SELECT name FROM pragma_index_list('vico_checkpoints') WHERE origin = 'pk'");
    expect(pkRows.rows.length).toBeGreaterThan(0);
    const pkIndexName = String(pkRows.rows[0].name);
    const pkInfo = await client.execute(`PRAGMA index_info('${pkIndexName}')`);
    const pkColNames = pkInfo.rows.map((r) => String(r.name)).sort();
    expect(pkColNames).toEqual(['turn_id', 'version']);
    const cols = await client.execute('PRAGMA table_info(vico_checkpoints)');
    const names = cols.rows.map((r) => String(r.name));
    expect(names).toContain('next_action');
    expect(names).toContain('turn_id');
    expect(names).toContain('version');
    expect(names).not.toContain('pending_tool');
    expect(names).not.toContain('updated_at');
    const turnsCols = (await client.execute('PRAGMA table_info(vico_turns)')).rows.map((r) => String(r.name));
    expect(turnsCols).toContain('forked_from');
  });

  it('旧单行结构（id 主键 + turn_id UNIQUE）：DROP 重建为多版本结构', async () => {
    const { client, db } = makeDb();
    await client.execute(`CREATE TABLE vico_checkpoints (
      id TEXT PRIMARY KEY,
      turn_id TEXT NOT NULL UNIQUE,
      thread_id TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      step_index INTEGER NOT NULL DEFAULT 0,
      paused INTEGER NOT NULL DEFAULT 0,
      pending_tool TEXT,
      snapshot TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`);
    await ensureTables(db as any);
    const cols = (await client.execute('PRAGMA table_info(vico_checkpoints)')).rows.map((r) => String(r.name));
    expect(cols).not.toContain('id');
    expect(cols).not.toContain('paused');
    expect(cols).toContain('next_action');
  });

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
    await ensureTables(db as any);
    const cols = (await client.execute('PRAGMA table_info(vico_turns)')).rows.map((r) => String(r.name));
    expect(cols).toContain('forked_from');
  });
});
