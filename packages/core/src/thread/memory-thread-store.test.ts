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
