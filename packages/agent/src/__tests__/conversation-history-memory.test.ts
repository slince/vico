// src/__tests__/conversation-history-memory.test.ts
import { describe, it, beforeEach, expect } from 'vitest';
import { ConversationHistoryMemory } from '../memory/conversation-history-memory.js';
import { InMemorySessionStore } from '../session/memory-session-store.js';

describe('ConversationHistoryMemory', () => {
  let sessionStore: InMemorySessionStore;
  let historyStore: ConversationHistoryMemory;

  beforeEach(() => {
    sessionStore = new InMemorySessionStore();
    historyStore = new ConversationHistoryMemory(sessionStore);
  });

  async function seedMessages(threadId: string, count: number) {
    for (let i = 0; i < count; i++) {
      await sessionStore.appendEntry({
        threadId,
        turnId: 't1',
        role: 'user',
        content: `msg${i}`,
      });
    }
  }

  it('reads messages via session store', async () => {
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
