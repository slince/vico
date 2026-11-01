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

describe('InMemoryThreadStore.archiveMessagesByTurns / includeArchived', () => {
  it('archiveMessagesByTurns 软标记整个 turn 的消息；includeArchived:false 排除', async () => {
    const store = new InMemoryThreadStore();
    await store.createThread('a', 't', 'thread-1');
    const [m1, m2] = await store.appendEntries([
      { threadId: 'thread-1', turnId: 'turn-1', role: 'user', content: 'hi' },
      { threadId: 'thread-1', turnId: 'turn-2', role: 'assistant', content: 'yo' },
    ]);

    await store.archiveMessagesByTurns('thread-1', ['turn-1']);

    const all = await store.getEntries('thread-1');
    expect(all.map((m) => m.id)).toEqual([m1.id, m2.id]);
    expect(all[0].archived).toBe(true);
    expect(all[1].archived).toBeUndefined();

    const active = await store.getEntries('thread-1', { includeArchived: false });
    expect(active.map((m) => m.id)).toEqual([m2.id]);
  });

  it('getEntriesByTurns 支持 includeArchived 过滤', async () => {
    const store = new InMemoryThreadStore();
    await store.createThread('a', 't', 'thread-1');
    await store.appendEntries([
      { threadId: 'thread-1', turnId: 'turn-1', role: 'user', content: 'hi' },
      { threadId: 'thread-1', turnId: 'turn-2', role: 'assistant', content: 'yo' },
    ]);
    await store.archiveMessagesByTurns('thread-1', ['turn-1']);

    const active = await store.getEntriesByTurns(['turn-1', 'turn-2'], { includeArchived: false });
    expect(active.map((m) => m.content)).toEqual(['yo']);
  });

  it('archiveMessagesByTurns 幂等且忽略不存在的 turn', async () => {
    const store = new InMemoryThreadStore();
    await store.createThread('a', 't', 'thread-1');
    await store.appendEntries([
      { threadId: 'thread-1', turnId: 'turn-1', role: 'user', content: 'hi' },
    ]);
    await store.archiveMessagesByTurns('thread-1', ['turn-1', 'nope']);
    await store.archiveMessagesByTurns('thread-1', ['turn-1']);
    const active = await store.getEntries('thread-1', { includeArchived: false });
    expect(active).toHaveLength(0);
  });
});
