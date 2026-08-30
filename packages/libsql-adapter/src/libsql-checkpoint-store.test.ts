import { describe, expect, it } from 'vitest';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { ensureTables } from './migrate.js';
import { LibSqlCheckpointStore } from './libsql-checkpoint-store.js';
import * as schema from './schema.js';
import type { CheckpointAppendPatch } from '@vico/core';

function patch(overrides: Partial<CheckpointAppendPatch> = {}): CheckpointAppendPatch {
  return { stepIndex: 1, nextAction: 'model', approvedTools: {}, pauseInfo: null, lastMessageId: null, ...overrides };
}

async function makeStore() {
  const client = createClient({ url: ':memory:' });
  const db = drizzle(client, { schema });
  await ensureTables(db as any);
  return new LibSqlCheckpointStore(db as any);
}

describe('LibSqlCheckpointStore（多版本链）', () => {
  it('create + append 版本递增、getLatest 取最新', async () => {
    const store = await makeStore();
    await store.create('turn-1', 'thread-1');
    await store.append('turn-1', patch({ stepIndex: 1, nextAction: 'end' }));
    const latest = await store.getLatest('turn-1');
    expect(latest?.version).toBe(2);
    expect(latest?.nextAction).toBe('end');
  });

  it('listVersions 升序 + getVersion 定位', async () => {
    const store = await makeStore();
    await store.create('turn-1', 'thread-1');
    await store.append('turn-1', patch({ stepIndex: 2 }));
    const versions = await store.listVersions('turn-1');
    expect(versions.map((v) => v.version)).toEqual([1, 2]);
    expect((await store.getVersion('turn-1', 2))?.stepIndex).toBe(2);
  });

  it('fork 复制快照到新 turn 初始版本，原链不变', async () => {
    const store = await makeStore();
    await store.create('turn-1', 'thread-1');
    await store.append('turn-1', patch({ stepIndex: 4, nextAction: 'tool-approval', pauseInfo: { reason: 'tool-approval', pendingToolCalls: [], pausedAtStep: 4 } }));
    const forked = await store.fork('turn-1', 2, 'turn-2', 'thread-2');
    expect(forked?.version).toBe(1);
    expect(forked?.stepIndex).toBe(4);
    expect(forked?.pauseInfo?.pausedAtStep).toBe(4);
    expect(await store.fork('turn-1', 99, 'turn-3', 'thread-3')).toBeUndefined();
  });

  it('purgeExpired 整链删除 + deleteByTurn 清链', async () => {
    const store = await makeStore();
    await store.create('turn-old', 'thread-1');
    await store.append('turn-old', patch());
    await store.create('turn-new', 'thread-1');
    // 手工把 turn-old 版本 created_at 调旧
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
