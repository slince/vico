// src/__tests__/context-compactor.test.ts
import { describe, it, expect } from 'vitest';
import { ContextCompactor } from '../src/agent/context-compactor.js';

describe('ContextCompactor', () => {
  it('does not compact below threshold', async () => {
    const c = new ContextCompactor(100000, 3);
    const msgs = [{ role: 'user' as const, content: 'short' }];
    const result = await c.compactIfNeeded(msgs, null as any, new AbortController().signal);
    expect(result.wasCompacted).toBe(false);
  });

  it('compacts when over threshold', async () => {
    const c = new ContextCompactor(10, 3);
    const msgs = Array.from({ length: 10 }, (_, i) => ({ role: 'user' as const, content: `very long message number ${i}`.repeat(50) }));
    const result = await c.compactIfNeeded(msgs, null as any, new AbortController().signal);
    // Falls back to simple truncation since model is null
    expect(result.wasCompacted).toBe(true);
    expect(result.compacted).toHaveLength(4); // summary + 3 recent
    expect(result.removedTokens).toBeGreaterThan(0);
  });

  it('does not compact if too few items', async () => {
    const c = new ContextCompactor(10, 3);
    const msgs = Array.from({ length: 4 }, (_, i) => ({ role: 'user' as const, content: `very long message number ${i}`.repeat(50) }));
    const result = await c.compactIfNeeded(msgs, null as any, new AbortController().signal);
    // 4 <= keepRecent(3) + 2, so skip compaction
    expect(result.wasCompacted).toBe(false);
  });
});
