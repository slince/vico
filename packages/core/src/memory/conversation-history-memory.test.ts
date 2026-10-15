import { describe, expect, it } from 'vitest';
import { InMemoryThreadStore } from '../thread/memory-thread-store.js';
import { ConversationHistoryMemory } from './conversation-history-memory.js';

async function seed(): Promise<{ store: InMemoryThreadStore; turnIds: string[] }> {
  const store = new InMemoryThreadStore();
  await store.createThread('agent', 't', 'thread-1');
  const turnIds: string[] = [];
  for (const [text, status] of [['one', 'completed'], ['two', 'completed'], ['three', 'failed']] as const) {
    const turn = await store.createTurn('thread-1');
    turnIds.push(turn.id);
    await store.appendEntries([{ threadId: 'thread-1', turnId: turn.id, role: 'user', content: JSON.stringify(text) }]);
    await store.updateTurn(turn.id, { status });
  }
  return { store, turnIds };
}

describe('ConversationHistoryMemory.get', () => {
  it('只读取 completed turn（failed 被过滤）', async () => {
    const { store } = await seed();
    const mem = new ConversationHistoryMemory(store, 10);
    const history = await mem.get('thread-1');
    expect(history.map((m) => (m.content as string))).toEqual(['one', 'two']);
  });

  it('摘要消息前置并转 role=system，归档消息不读取', async () => {
    const { store, turnIds } = await seed();
    // 归档 first turn 的消息
    const first = await store.getEntriesByTurns([turnIds[0]]);
    await store.archiveMessages('thread-1', first.map((m) => m.id));
    // 写一条摘要
    await store.appendEntries([{ threadId: 'thread-1', turnId: 'thread-1', role: 'summary', content: JSON.stringify('prior summary') }]);

    const mem = new ConversationHistoryMemory(store, 10);
    const history = await mem.get('thread-1');
    expect(history[0]).toEqual({ role: 'system', content: 'prior summary' });
    // 归档 turn 不再出现在历史
    expect(history.map((m) => (m.content as string))).not.toContain('one');
  });
});
