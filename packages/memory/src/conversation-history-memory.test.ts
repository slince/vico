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
    await store.appendEntries([{ threadId: 'thread-1', turnId: t1.id, role: 'user', content: 'one' }]);
    await store.appendEntries([{ threadId: 'thread-1', turnId: t2.id, role: 'user', content: 'two' }]);

    const mem = new ConversationHistoryMemory(store);
    const history = await mem.get('thread-1');
    expect(history.map((m) => (m.content as string))).toEqual(['one', 'two']);
  });

  it('摘要以用户消息前置，归档消息不读取', async () => {
    const { store } = await seed();
    const t1 = await store.createTurn('thread-1');
    await store.appendEntries([{ threadId: 'thread-1', turnId: t1.id, role: 'user', content: 'old' }]);
    const first = await store.getEntries('thread-1');
    await store.archiveMessages('thread-1', first.map((m) => m.id));

    // 写摘要 + 摘要后的新消息
    await store.appendEntries([{ threadId: 'thread-1', turnId: 'thread-1', role: 'summary', content: 'prior summary' }]);
    const t2 = await store.createTurn('thread-1');
    await store.appendEntries([{ threadId: 'thread-1', turnId: t2.id, role: 'user', content: 'after summary' }]);

    const mem = new ConversationHistoryMemory(store);
    const history = await mem.get('thread-1');
    expect(history[0]).toMatchObject({ role: 'user', content: 'prior summary', turnId: 'thread-1' });
    expect(history.map((m) => (m.content as string))).toEqual(['prior summary', 'after summary']);
  });

  it('excludeTurnId 排除指定 turn 的普通消息，但保留 summary（压缩后重建历史前缀）', async () => {
    const { store } = await seed();
    const t1 = await store.createTurn('thread-1');
    await store.appendEntries([{ threadId: 'thread-1', turnId: t1.id, role: 'user', content: 'one' }]);
    await store.updateTurn(t1.id, { status: 'completed' });

    // 当前 turn（running）：一条用户消息 + 一条 summary（都挂当前 turn）
    const t2 = await store.createTurn('thread-1');
    await store.appendEntries([{ threadId: 'thread-1', turnId: t2.id, role: 'user', content: 'two' }]);
    await store.appendEntries([{ threadId: 'thread-1', turnId: t2.id, role: 'summary', content: 'prior summary' }]);

    const mem = new ConversationHistoryMemory(store);
    const history = await mem.get('thread-1', t2.id);
    expect(history.map((m) => (m.content as string))).toEqual(['prior summary', 'one']);
  });
});
