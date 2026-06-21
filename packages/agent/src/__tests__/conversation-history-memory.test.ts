// src/__tests__/conversation-history-memory.test.ts
import { describe, it, expect } from 'vitest';
import { ConversationHistoryMemoryStore } from '../memory/conversation-history-memory.js';

describe('ConversationHistoryMemoryStore', () => {
  it('stores and retrieves messages', async () => {
    const store = new ConversationHistoryMemoryStore();
    await store.push('t1', { role: 'user', content: 'hi' });
    expect(await store.get('t1', 10)).toHaveLength(1);
  });

  it('enforces FIFO window', async () => {
    const store = new ConversationHistoryMemoryStore();
    for (let i = 0; i < 10; i++) await store.push('t1', { role: 'user', content: `msg${i}` });
    expect(await store.get('t1', 3)).toHaveLength(3);
    expect((await store.get('t1', 3))[2].content).toBe('msg9');
  });

  it('clears a specific thread', async () => {
    const store = new ConversationHistoryMemoryStore();
    await store.push('t1', { role: 'user', content: 'hi' });
    await store.push('t2', { role: 'user', content: 'hello' });
    store.clear('t1');
    expect(await store.get('t1', 10)).toHaveLength(0);
    expect(await store.get('t2', 10)).toHaveLength(1);
  });

  it('clears all threads', async () => {
    const store = new ConversationHistoryMemoryStore();
    await store.push('t1', { role: 'user', content: 'hi' });
    await store.push('t2', { role: 'user', content: 'hello' });
    store.clearAll();
    expect(await store.get('t1', 10)).toHaveLength(0);
    expect(await store.get('t2', 10)).toHaveLength(0);
  });
});
