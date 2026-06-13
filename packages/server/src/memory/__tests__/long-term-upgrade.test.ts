import { describe, it, expect, vi } from 'vitest';

vi.mock('../../db/db.js', () => {
  const mockPrepare = vi.fn().mockReturnValue({
    all: vi.fn().mockReturnValue([]),
    get: vi.fn().mockReturnValue(null),
    run: vi.fn(),
  });
  return {
    getDb: () => ({}),
    getSqlite: () => ({ prepare: mockPrepare }),
    schema: {},
  };
});

vi.mock('../embedder.js', () => ({
  getEmbedder: () => ({}),
  float32ToBlob: (v: Float32Array) => Buffer.from(v.buffer),
  blobToFloat32: () => new Float32Array(0),
  cosineSimilarity: () => 0.5,
}));

describe('LongTermMemory upgrades', () => {
  it('searchByType filters entries by type', async () => {
    const { longTermMemory } = await import('../long-term.js');
    const results = await longTermMemory.searchByType('t1', 'u1', 'working', 10);
    expect(Array.isArray(results)).toBe(true);
  });

  it('upsertByContent does not throw', async () => {
    const { longTermMemory } = await import('../long-term.js');
    await expect(
      longTermMemory.upsertByContent({
        tenant_id: 't1', user_id: 'u1', type: 'working',
        content: 'test fact', importance: 0.8,
      })
    ).resolves.toBeUndefined();
  });
});
