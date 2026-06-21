// src/__tests__/conversation-history-memory.test.ts
import { describe, it, expect } from 'vitest';
import { ConversationHistoryMemoryStore } from '../memory/conversation-history-memory.js';

describe('ConversationHistoryMemoryStore', () => {
  it('stores and retrieves messages', () => {
    const store = new ConversationHistoryMemoryStore();
    store.push('t1', { role: 'user', content: 'hi' });
    expect(store.get('t1', 10)).toHaveLength(1);
  });

  it('enforces FIFO window', () => {
    const store = new ConversationHistoryMemoryStore();
    for (let i = 0; i < 10; i++) store.push('t1', { role: 'user', content: `msg${i}` });
    expect(store.get('t1', 3)).toHaveLength(3);
    expect(store.get('t1', 3)[2].content).toBe('msg9');
  });

  it('clears a specific thread', () => {
    const store = new ConversationHistoryMemoryStore();
    store.push('t1', { role: 'user', content: 'hi' });
    store.push('t2', { role: 'user', content: 'hello' });
    store.clear('t1');
    expect(store.get('t1', 10)).toHaveLength(0);
    expect(store.get('t2', 10)).toHaveLength(1);
  });

  it('clears all threads', () => {
    const store = new ConversationHistoryMemoryStore();
    store.push('t1', { role: 'user', content: 'hi' });
    store.push('t2', { role: 'user', content: 'hello' });
    store.clearAll();
    expect(store.get('t1', 10)).toHaveLength(0);
    expect(store.get('t2', 10)).toHaveLength(0);
  });
});
