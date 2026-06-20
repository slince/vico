// src/__tests__/short-term-memory.test.ts
import { describe, it, expect } from 'vitest';
import { ShortTermMemory } from '../memory/short-term-memory.js';

describe('ShortTermMemory', () => {
  it('stores and retrieves messages', () => {
    const stm = new ShortTermMemory();
    stm.push('t1', { role: 'user', content: 'hi' });
    expect(stm.get('t1', 10)).toHaveLength(1);
  });

  it('enforces FIFO window', () => {
    const stm = new ShortTermMemory();
    for (let i = 0; i < 10; i++) stm.push('t1', { role: 'user', content: `msg${i}` });
    expect(stm.get('t1', 3)).toHaveLength(3);
    expect(stm.get('t1', 3)[2].content).toBe('msg9');
  });

  it('clears a specific thread', () => {
    const stm = new ShortTermMemory();
    stm.push('t1', { role: 'user', content: 'hi' });
    stm.push('t2', { role: 'user', content: 'hello' });
    stm.clear('t1');
    expect(stm.get('t1', 10)).toHaveLength(0);
    expect(stm.get('t2', 10)).toHaveLength(1);
  });

  it('clears all threads', () => {
    const stm = new ShortTermMemory();
    stm.push('t1', { role: 'user', content: 'hi' });
    stm.push('t2', { role: 'user', content: 'hello' });
    stm.clearAll();
    expect(stm.get('t1', 10)).toHaveLength(0);
    expect(stm.get('t2', 10)).toHaveLength(0);
  });
});
