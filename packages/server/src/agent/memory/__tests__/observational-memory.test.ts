import { describe, it, expect, vi } from 'vitest';

// Mock config
vi.mock('../../../config.js', () => ({
  config: {
    memory: { stm_window: 20 },
  },
}));

// Drizzle mock for memory_entries queries
const mockInsert = vi.fn().mockReturnThis();
const mockValues = vi.fn().mockReturnThis();
const mockDrizzleRun = vi.fn().mockReturnValue(Promise.resolve());

mockInsert.mockReturnValue({ values: mockValues });
mockValues.mockReturnValue({ run: mockDrizzleRun });

const mockSelect = vi.fn().mockReturnThis();
const mockFrom = vi.fn().mockReturnThis();
const mockWhere = vi.fn().mockReturnThis();
const mockOrderBy = vi.fn().mockReturnThis();
const mockLimit = vi.fn().mockReturnThis();
const mockAll = vi.fn().mockReturnValue(Promise.resolve([]));

mockSelect.mockReturnValue({ from: mockFrom });
mockFrom.mockReturnValue({ where: mockWhere });
mockWhere.mockReturnValue({ orderBy: mockOrderBy });
mockOrderBy.mockReturnValue({ limit: mockLimit });
mockLimit.mockReturnValue({ all: mockAll });

const dbMock = {
  select: mockSelect,
  insert: mockInsert,
};

// Client mock for raw messages table queries
const mockClientExecute = vi.fn();

vi.mock('../../../db/db.js', () => ({
  getClient: () => ({ execute: mockClientExecute }),
  getDb: () => dbMock,
  getDatabaseUrl: () => '',
  schema: {
    memory_entries: {
      id: 'id', tenant_id: 'tenant_id', user_id: 'user_id',
      type: 'type', content: 'content', importance: 'importance',
      created_at: 'created_at',
    },
  },
}));

import { ObservationalMemory } from '../observational-memory.js';

describe('ObservationalMemory (Drizzle ORM)', () => {
  it('maybeCompress returns false when below threshold', async () => {
    mockClientExecute.mockReturnValueOnce(Promise.resolve({
      rows: [[5]], columns: ['count'],
    }));

    const om = new ObservationalMemory();
    const result = await om.maybeCompress('t1', 'conv1');
    expect(result).toBe(false);
  });

  it('maybeCompress stores summary when above threshold', async () => {
    mockClientExecute.mockReturnValueOnce(Promise.resolve({
      rows: [[50]], columns: ['count'],
    }));
    mockClientExecute.mockReturnValueOnce(Promise.resolve({
      rows: Array.from({ length: 20 }, (_, i) => [
        i % 2 === 0 ? 'user' : 'assistant',
        `消息内容 ${i}`,
      ]),
      columns: ['role', 'content'],
    }));

    const om = new ObservationalMemory();
    const result = await om.maybeCompress('t1', 'conv1');
    expect(result).toBe(true);
    expect(mockDrizzleRun).toHaveBeenCalled();
  });

  it('retrieve queries by conversation prefix', async () => {
    mockAll.mockReturnValueOnce(Promise.resolve([
      { id: '1', content: '[Conversation conv1]\n摘要内容', type: 'observation' },
    ]));

    const om = new ObservationalMemory();
    const rows = await om.retrieve('t1', 'conv1');
    expect(rows).toHaveLength(1);
  });

  it('retrieveAsPrompt formats observation rows', () => {
    const om = new ObservationalMemory();
    const prompt = om.retrieveAsPrompt([
      { content: '[Conversation conv1]\n摘要内容' },
    ]);
    expect(prompt).toContain('对话历史摘要');
    expect(prompt).toContain('摘要内容');
    expect(prompt).not.toContain('[Conversation');
  });

  it('retrieveAsPrompt returns empty for no rows', () => {
    const om = new ObservationalMemory();
    expect(om.retrieveAsPrompt([])).toBe('');
  });
});
