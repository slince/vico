// src/__tests__/conversation-history-memory.test.ts
import {beforeEach, describe, expect, it} from 'vitest';
import {ConversationHistoryMemory} from '../src/memory/conversation-history-memory.js';
import {InMemoryThreadStore} from '../src/thread/memory-thread-store.js';

describe('ConversationHistoryMemory', () => {
  let threadStore: InMemoryThreadStore;
  let historyStore: ConversationHistoryMemory;

  beforeEach(() => {
    threadStore = new InMemoryThreadStore();
    historyStore = new ConversationHistoryMemory(threadStore, 10);
  });

  async function seedMessages(threadId: string, count: number) {
    const entries = Array.from({ length: count }, (_, i) => ({
      threadId,
      turnId: 't1',
      role: 'user',
      content: `msg${i}`,
    }));
    await threadStore.appendEntries(entries);
  }

  it('reads messages via thread store', async () => {
    await seedMessages('t1', 3);
    const msgs = await historyStore.get('t1', 10);
    expect(msgs).toHaveLength(3);
    expect(msgs[0].content).toBe('msg0');
  });

  it('enforces FIFO window via limit', async () => {
    await seedMessages('t1', 10);
    const msgs = await historyStore.get('t1', 3);
    expect(msgs).toHaveLength(3);
    expect(msgs[2].content).toBe('msg9');
  });

  it('returns empty for unknown thread', async () => {
    const msgs = await historyStore.get('t1', 10);
    expect(msgs).toHaveLength(0);
  });
});
