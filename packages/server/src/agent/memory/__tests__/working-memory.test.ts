import { describe, it, expect, vi } from 'vitest';
import { WorkingMemory } from '../working-memory.js';

vi.mock('../../../memory/long-term.js', () => ({
  longTermMemory: {
    upsertByContent: vi.fn().mockResolvedValue(undefined),
    searchByType: vi.fn().mockResolvedValue([
      { content: '用户偏好简洁回复', importance: 0.8, type: 'working' },
    ]),
  },
}));

describe('WorkingMemory', () => {
  beforeEach(async () => {
    const { longTermMemory } = await import('../../../memory/long-term.js');
    vi.clearAllMocks();
    (longTermMemory.searchByType as ReturnType<typeof vi.fn>).mockResolvedValue([
      { content: '用户偏好简洁回复', importance: 0.8, type: 'working' },
    ]);
  });

  it('extractAndStore matches preference patterns', async () => {
    const wm = new WorkingMemory();
    const messages = [
      { role: 'user', content: '我喜欢简洁的回复方式' },
    ];
    await wm.extractAndStore('t1', 'u1', messages);
    const { longTermMemory } = await import('../../../memory/long-term.js');
    expect(longTermMemory.upsertByContent).toHaveBeenCalled();
  });

  it('extractAndStore skips non-user messages', async () => {
    const wm = new WorkingMemory();
    const messages = [
      { role: 'assistant', content: '我注意到你喜欢简洁回复' },
    ];
    await wm.extractAndStore('t1', 'u1', messages);
    const { longTermMemory } = await import('../../../memory/long-term.js');
    expect(longTermMemory.upsertByContent).not.toHaveBeenCalled();
  });

  it('retrieve returns working-type entries', async () => {
    const wm = new WorkingMemory();
    const entries = await wm.retrieve('t1', 'u1');
    expect(entries).toHaveLength(1);
  });

  it('retrieveAsPrompt formats entries', async () => {
    const wm = new WorkingMemory();
    const prompt = await wm.retrieveAsPrompt('t1', 'u1');
    expect(prompt).toContain('用户信息');
    expect(prompt).toContain('用户偏好简洁回复');
  });

  it('retrieveAsPrompt returns empty string when no entries', async () => {
    const { longTermMemory } = await import('../../../memory/long-term.js');
    (longTermMemory.searchByType as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);
    const wm2 = new WorkingMemory();
    const prompt = await wm2.retrieveAsPrompt('t1', 'u1');
    expect(prompt).toBe('');
  });
});
