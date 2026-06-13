import { describe, it, expect, vi } from 'vitest';

const mockExecute = vi.fn().mockImplementation(({ sql }: { sql: string }) => {
  if (sql.includes('SELECT * FROM memory_entries') && sql.includes("type IN ('working')")) {
    return Promise.resolve({
      rows: [['mem-id-1', 't1', 'u1', 'working', '用户偏好简洁回复', 0.8, Date.now()]],
      columns: ['id', 'tenant_id', 'user_id', 'type', 'content', 'importance', 'created_at'],
    });
  }
  if (sql.includes('SELECT id FROM memory_entries') && sql.includes('substr')) {
    // upsertByContent: no existing entry found -> insert path
    return Promise.resolve({ rows: [], columns: ['id'] });
  }
  // INSERT statements
  return Promise.resolve({ rows: [], columns: [] });
});

vi.mock('../../../db/db.js', () => ({
  getClient: () => ({ execute: mockExecute }),
  getDb: () => ({}),
  getDatabaseUrl: () => '',
  schema: {},
}));

import { WorkingMemory } from '../working-memory.js';

describe('WorkingMemory', () => {
  it('extractAndStore matches preference patterns', async () => {
    vi.clearAllMocks();
    const wm = new WorkingMemory();
    const messages = [
      { role: 'user', content: '我喜欢简洁的回复方式' },
    ];
    await wm.extractAndStore('t1', 'u1', messages);
    // Should have called execute for upsertByContent
    expect(mockExecute).toHaveBeenCalled();
  });

  it('extractAndStore skips non-user messages', async () => {
    vi.clearAllMocks();
    const wm = new WorkingMemory();
    const messages = [
      { role: 'assistant', content: '我注意到你喜欢简洁回复' },
    ];
    await wm.extractAndStore('t1', 'u1', messages);
    // No DB calls for non-user messages
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('retrieve returns working-type entries', async () => {
    const wm = new WorkingMemory();
    const entries = await wm.retrieve('t1', 'u1');
    expect(entries).toHaveLength(1);
    expect(entries[0].content).toBe('用户偏好简洁回复');
  });

  it('retrieveAsPrompt formats entries', async () => {
    const wm = new WorkingMemory();
    const prompt = await wm.retrieveAsPrompt('t1', 'u1');
    expect(prompt).toContain('用户信息');
    expect(prompt).toContain('用户偏好简洁回复');
  });

  it('retrieveAsPrompt returns empty string when no entries', async () => {
    // Override mock to return empty for this test
    mockExecute.mockImplementationOnce(() =>
      Promise.resolve({ rows: [], columns: ['id', 'tenant_id', 'user_id', 'type', 'content', 'importance', 'created_at'] }),
    );
    const wm2 = new WorkingMemory();
    const prompt = await wm2.retrieveAsPrompt('t1', 'u1');
    expect(prompt).toBe('');
  });
});
