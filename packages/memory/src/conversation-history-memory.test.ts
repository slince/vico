import { describe, expect, it } from 'vitest';
import { InMemoryThreadStore } from '@vico/thread';
import { ConversationHistoryMemory } from './conversation-history-memory.js';

async function seed(): Promise<{ store: InMemoryThreadStore }> {
  const store = new InMemoryThreadStore();
  await store.createThread('agent', 't', 'thread-1');
  return { store };
}

describe('ConversationHistoryMemory.get', () => {
  it('无摘要时注入全部非归档消息（含未完结 turn）', async () => {
    const { store } = await seed();
    const t1 = await store.createTurn('thread-1');
    const t2 = await store.createTurn('thread-1');
    await store.appendEntries([{ threadId: 'thread-1', turnId: t1.id, role: 'user', content: JSON.stringify('one') }]);
    await store.appendEntries([{ threadId: 'thread-1', turnId: t2.id, role: 'user', content: JSON.stringify('two') }]);

    const mem = new ConversationHistoryMemory(store);
    const history = await mem.get('thread-1');
    expect(history.map((m) => (m.content as string))).toEqual(['one', 'two']);
  });

  it('摘要以用户消息前置，归档消息不读取', async () => {
    const { store } = await seed();
    const t1 = await store.createTurn('thread-1');
    await store.appendEntries([{ threadId: 'thread-1', turnId: t1.id, role: 'user', content: JSON.stringify('old') }]);
    const first = await store.getEntries('thread-1');
    await store.archiveMessages('thread-1', first.map((m) => m.id));

    // 写摘要 + 摘要后的新消息
    await store.appendEntries([{ threadId: 'thread-1', turnId: 'thread-1', role: 'summary', content: JSON.stringify('prior summary') }]);
    const t2 = await store.createTurn('thread-1');
    await store.appendEntries([{ threadId: 'thread-1', turnId: t2.id, role: 'user', content: JSON.stringify('after summary') }]);

    const mem = new ConversationHistoryMemory(store);
    const history = await mem.get('thread-1');
    expect(history[0]).toEqual({ role: 'user', content: 'prior summary' });
    expect(history.map((m) => (m.content as string))).toEqual(['prior summary', 'after summary']);
  });
});
