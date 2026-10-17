import { describe, expect, it } from 'vitest';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { ensureCheckpointTables } from './migrate.js';
import { checkpoints } from './schema.js';

function makeDb() {
  const client = createClient({ url: ':memory:' });
  const db = drizzle(client, { schema: { checkpoints } });
  return { client, db };
}

describe('ensureCheckpointTables（版本树 checkpoint 表）', () => {
  it('全新库：建出 id 单列主键 + parent_id + UNIQUE(turn_id,version)', async () => {
    const { client, db } = makeDb();
    await ensureCheckpointTables(db as never);
    const info = (await client.execute('PRAGMA table_info(vico_checkpoints)')).rows;
    const names = info.map((r) => String(r.name));
    expect(names).toContain('id');
    expect(names).toContain('parent_id');
    expect(names).toContain('next_action');
    expect(names).toContain('turn_id');
    expect(names).toContain('version');
    expect(names).not.toContain('pending_tool');
    expect(names).not.toContain('updated_at');
    expect(names).not.toContain('paused');
    // id 单列主键（非 (turn_id, version) 复合主键）
    const pkCols = info.filter((r) => Number(r.pk) > 0).map((r) => String(r.name));
    expect(pkCols).toEqual(['id']);
    // UNIQUE(turn_id, version) 约束
    const uqRows = await client.execute("SELECT name FROM pragma_index_list('vico_checkpoints') WHERE origin = 'u'");
    expect(uqRows.rows.length).toBe(1);
    const uqIndexName = String(uqRows.rows[0].name);
    const uqInfo = await client.execute(`PRAGMA index_info('${uqIndexName}')`);
    expect(uqInfo.rows.map((r) => String(r.name)).sort()).toEqual(['turn_id', 'version']);
  });

  it('旧复合主键结构（无 id/parent_id）：DROP 重建为版本树', async () => {
    const { client, db } = makeDb();
    await client.execute(`CREATE TABLE vico_checkpoints (
      turn_id TEXT NOT NULL,
      thread_id TEXT NOT NULL,
      version INTEGER NOT NULL,
      step_index INTEGER NOT NULL,
      next_action TEXT NOT NULL,
      snapshot TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (turn_id, version)
    )`);
    await ensureCheckpointTables(db as never);
    const info = (await client.execute('PRAGMA table_info(vico_checkpoints)')).rows;
    const names = info.map((r) => String(r.name));
    expect(names).toContain('id');
    expect(names).toContain('parent_id');
    // 复合主键已替换为 id 单列主键
    const pkCols = info.filter((r) => Number(r.pk) > 0).map((r) => String(r.name));
    expect(pkCols).toEqual(['id']);
  });
});
