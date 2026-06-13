import { describe, it, expect, vi } from 'vitest';

const mockPrepare = vi.fn();

vi.mock('../../../db/db.js', () => ({
  getSqlite: () => ({
    prepare: mockPrepare,
  }),
  getDb: () => ({}),
  schema: {},
}));

vi.mock('../../../config.js', () => ({
  config: {
    memory: { stm_window: 20 },
  },
}));

describe('ObservationalMemory', () => {
  it('maybeCompress returns false when below threshold', async () => {
    mockPrepare.mockReturnValue({
      get: vi.fn().mockReturnValue({ count: 5 }),
      all: vi.fn().mockReturnValue([]),
      run: vi.fn(),
    });

    const { ObservationalMemory } = await import('../observational-memory.js');
    const om = new ObservationalMemory();
    const result = await om.maybeCompress('t1', 'conv1');
    expect(result).toBe(false);
  });

  it('maybeCompress stores summary when above threshold', async () => {
    const mockRun = vi.fn();
    mockPrepare.mockReturnValue({
      get: vi.fn().mockReturnValue({ count: 50 }),
      all: vi.fn().mockReturnValue(
        Array.from({ length: 40 }, (_, i) => ({
          role: i % 2 === 0 ? 'user' : 'assistant',
          content: `消息内容 ${i}`,
        }))
      ),
      run: mockRun,
    });

    const { ObservationalMemory } = await import('../observational-memory.js');
    const om = new ObservationalMemory();
    const result = await om.maybeCompress('t1', 'conv1');
    expect(result).toBe(true);
    expect(mockRun).toHaveBeenCalled();
  });

  it('retrieve queries by conversation prefix', async () => {
    const mockAll = vi.fn().mockReturnValue([
      { id: '1', content: '[Conversation conv1]\n摘要内容', type: 'observation' },
    ]);
    mockPrepare.mockReturnValue({
      get: vi.fn(),
      all: mockAll,
      run: vi.fn(),
    });

    const { ObservationalMemory } = await import('../observational-memory.js');
    const om = new ObservationalMemory();
    const rows = await om.retrieve('t1', 'conv1');
    expect(rows).toHaveLength(1);
  });

  it('retrieveAsPrompt formats observation rows', async () => {
    const { ObservationalMemory } = await import('../observational-memory.js');
    const om = new ObservationalMemory();
    const prompt = om.retrieveAsPrompt([
      { content: '[Conversation conv1]\n摘要内容' },
    ]);
    expect(prompt).toContain('对话历史摘要');
    expect(prompt).toContain('摘要内容');
    expect(prompt).not.toContain('[Conversation');
  });

  it('retrieveAsPrompt returns empty for no rows', async () => {
    const { ObservationalMemory } = await import('../observational-memory.js');
    const om = new ObservationalMemory();
    expect(om.retrieveAsPrompt([])).toBe('');
  });
});
