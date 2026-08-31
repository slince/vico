import { describe, expect, it } from 'vitest';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { ensureTables } from './migrate.js';
import { LibSqlCheckpointStore } from './libsql-checkpoint-store.js';
import * as schema from './schema.js';
import type { CheckpointAppendPatch } from '@vico/core';

function patch(overrides: Partial<CheckpointAppendPatch> = {}): CheckpointAppendPatch {
  return { parentId: null, stepIndex: 1, nextAction: 'model', approvedTools: {}, pendingApprovalCalls: [], approvedCalls: [], deniedResults: [], lastMessageId: null, ...overrides };
}

async function makeStore() {
  const client = createClient({ url: ':memory:' });
  const db = drizzle(client, { schema });
  await ensureTables(db as any);
  return new LibSqlCheckpointStore(db as any);
}

describe('LibSqlCheckpointStore（版本树）', () => {
  it('create + append 版本递增、getLatest 取最新', async () => {
    const store = await makeStore();
    const v1 = await store.create('turn-1', 'thread-1');
    const v2 = await store.append('turn-1', patch({ parentId: v1.id, stepIndex: 1, nextAction: 'end' }));
    expect(v2.id).toBeTruthy();
    expect(v2.parentId).toBe(v1.id);
    expect((await store.getLatest('turn-1'))?.version).toBe(2);
    expect((await store.getLatest('turn-1'))?.nextAction).toBe('end');
  });

  it('listVersions 升序 + getVersion/getById 定位', async () => {
    const store = await makeStore();
    const v1 = await store.create('turn-1', 'thread-1');
    const v2 = await store.append('turn-1', patch({ parentId: v1.id, stepIndex: 2 }));
    expect((await store.listVersions('turn-1')).map((v) => v.version)).toEqual([1, 2]);
    expect((await store.getVersion('turn-1', 2))?.stepIndex).toBe(2);
    expect((await store.getById(v2.id))?.stepIndex).toBe(2);
  });

  it('fork 复制快照到新 turn 初始版本，parentId 指向源版本 id', async () => {
    const store = await makeStore();
    const v1 = await store.create('turn-1', 'thread-1');
    const v2 = await store.append('turn-1', patch({ parentId: v1.id, stepIndex: 4, nextAction: 'tool-approval' }));
    const forked = await store.fork('turn-1', 2, 'turn-2', 'thread-2');
    expect(forked?.version).toBe(1);
    expect(forked?.stepIndex).toBe(4);
    expect(forked?.nextAction).toBe('tool-approval');
    expect(forked?.parentId).toBe(v2.id);
    expect(await store.fork('turn-1', 99, 'turn-3', 'thread-3')).toBeUndefined();
  });

  it('purgeExpired 整链删除 + deleteByTurn 清链', async () => {
    const store = await makeStore();
    const a = await store.create('turn-old', 'thread-1');
    await store.append('turn-old', patch({ parentId: a.id }));
    await store.create('turn-new', 'thread-1');
    const client = (store as any).db.$client as ReturnType<typeof createClient>;
    await client.execute(`UPDATE vico_checkpoints SET created_at = ${Date.now() - 100_000} WHERE turn_id = 'turn-old'`);
    const purged = await store.purgeExpired(10_000);
    expect(purged).toEqual(['turn-old']);
    expect(await store.listVersions('turn-old')).toEqual([]);
    expect((await store.listVersions('turn-new')).length).toBe(1);
    await store.deleteByTurn('turn-new');
    expect(await store.getLatest('turn-new')).toBeUndefined();
  });
});
