import { describe, expect, it } from 'vitest';
import { InMemoryThreadStore } from './memory-thread-store.js';

describe('InMemoryThreadStore.createTurn（forkedFrom）', () => {
  it('createTurn 接受 forkedFrom 并返回', async () => {
    const store = new InMemoryThreadStore();
    const turn = await store.createTurn('thread-1', { forkedFrom: { turnId: 'source-turn', version: 3 } });
    expect(turn.forkedFrom).toEqual({ turnId: 'source-turn', version: 3 });
    const fetched = await store.getTurn(turn.id);
    expect(fetched?.forkedFrom).toEqual({ turnId: 'source-turn', version: 3 });
  });

  it('不传 opts 时 forkedFrom 为 null', async () => {
    const store = new InMemoryThreadStore();
    const turn = await store.createTurn('thread-1');
    expect(turn.forkedFrom).toBeNull();
  });
});

describe('InMemoryThreadStore.archiveMessages / includeArchived', () => {
  it('archiveMessages 软标记消息；getEntries 默认含归档、includeArchived:false 排除', async () => {
    const store = new InMemoryThreadStore();
    await store.createThread('a', 't', 'thread-1');
    const [m1, m2] = await store.appendEntries([
      { threadId: 'thread-1', turnId: 'turn-1', role: 'user', content: '"hi"' },
      { threadId: 'thread-1', turnId: 'turn-1', role: 'assistant', content: '"yo"' },
    ]);

    await store.archiveMessages('thread-1', [m1.id]);

    const all = await store.getEntries('thread-1');
    expect(all.map((m) => m.id)).toEqual([m1.id, m2.id]);
    expect(all[0].archived).toBe(true);

    const active = await store.getEntries('thread-1', { includeArchived: false });
    expect(active.map((m) => m.id)).toEqual([m2.id]);
  });

  it('getEntriesByTurns 支持 includeArchived 过滤', async () => {
    const store = new InMemoryThreadStore();
    await store.createThread('a', 't', 'thread-1');
    const [m1, m2] = await store.appendEntries([
      { threadId: 'thread-1', turnId: 'turn-1', role: 'user', content: '"hi"' },
      { threadId: 'thread-1', turnId: 'turn-1', role: 'assistant', content: '"yo"' },
    ]);
    await store.archiveMessages('thread-1', [m1.id]);

    const active = await store.getEntriesByTurns(['turn-1'], { includeArchived: false });
    expect(active.map((m) => m.id)).toEqual([m2.id]);
  });

  it('archiveMessages 幂等且忽略不存在的 id', async () => {
    const store = new InMemoryThreadStore();
    await store.createThread('a', 't', 'thread-1');
    const [m1] = await store.appendEntries([
      { threadId: 'thread-1', turnId: 'turn-1', role: 'user', content: '"hi"' },
    ]);
    await store.archiveMessages('thread-1', [m1.id, 'nope']);
    await store.archiveMessages('thread-1', [m1.id]);
    const active = await store.getEntries('thread-1', { includeArchived: false });
    expect(active).toHaveLength(0);
  });
});
