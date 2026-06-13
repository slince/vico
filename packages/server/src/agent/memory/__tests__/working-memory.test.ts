import { describe, it, expect, vi } from 'vitest';

// Drizzle ORM mock — 返回链式查询接口
const mockSelect = vi.fn().mockReturnThis();
const mockFrom = vi.fn().mockReturnThis();
const mockWhere = vi.fn().mockReturnThis();
const mockOrderBy = vi.fn().mockReturnThis();
const mockLimit = vi.fn().mockReturnThis();
const mockAll = vi.fn().mockImplementation(() => {
  return Promise.resolve([
    {
      id: 'mem-id-1',
      tenant_id: 't1',
      user_id: 'u1',
      type: 'working',
      content: '用户偏好简洁回复',
      importance: 0.8,
      created_at: Date.now(),
    },
  ]);
});

const mockDrizzleRun = vi.fn().mockReturnValue(Promise.resolve());

const dbMock = {
  select: mockSelect,
  insert: vi.fn().mockReturnThis(),
  update: vi.fn().mockReturnThis(),
  values: vi.fn().mockReturnThis(),
  set: vi.fn().mockReturnThis(),
  run: mockDrizzleRun,
};

// 让 from() 返回可链式调用的对象
mockSelect.mockReturnValue({
  from: mockFrom,
});

mockFrom.mockReturnValue({
  where: mockWhere,
});

mockWhere.mockReturnValue({
  orderBy: mockOrderBy,
  limit: mockLimit,
  run: mockDrizzleRun,
  all: mockAll,
});

mockOrderBy.mockReturnValue({
  limit: mockLimit,
});

mockLimit.mockReturnValue({
  all: mockAll,
  run: mockDrizzleRun,
});

// insert mock chain: insert() → { values } → values() → { run }
dbMock.insert.mockReturnValue({
  values: vi.fn().mockReturnValue({ run: mockDrizzleRun }),
});

// update mock chain: update() → { set } → set() → { where } → where() → { run }
dbMock.update.mockReturnValue({
  set: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ run: mockDrizzleRun }) }),
});

vi.mock('../../../db/db.js', () => ({
  getClient: () => ({}),
  getDb: () => dbMock,
  getDatabaseUrl: () => '',
  schema: {
    memory_entries: {
      id: 'id',
      tenant_id: 'tenant_id',
      user_id: 'user_id',
      type: 'type',
      content: 'content',
      importance: 'importance',
      created_at: 'created_at',
    },
  },
}));

import { WorkingMemory } from '../working-memory.js';

describe('WorkingMemory (Drizzle ORM)', () => {
  it('extractAndStore matches preference patterns', async () => {
    // SELECT returns empty → INSERT path
    mockAll.mockReturnValueOnce(Promise.resolve([]));
    const wm = new WorkingMemory();
    const messages = [
      { role: 'user', content: '我喜欢简洁的回复方式' },
    ];
    await wm.extractAndStore('t1', 'u1', messages);
    expect(dbMock.insert).toHaveBeenCalled();
  });

  it('extractAndStore skips negated patterns', async () => {
    vi.clearAllMocks();
    const wm = new WorkingMemory();
    const messages = [
      { role: 'user', content: '我不喜欢太啰嗦的回复' },
    ];
    await wm.extractAndStore('t1', 'u1', messages);
    expect(dbMock.insert).not.toHaveBeenCalled();
  });

  it('extractAndStore handles English patterns', async () => {
    // SELECT returns empty → INSERT path
    mockAll.mockReturnValueOnce(Promise.resolve([]));
    vi.clearAllMocks();
    const wm = new WorkingMemory();
    const messages = [
      { role: 'user', content: 'I prefer short and concise answers' },
    ];
    await wm.extractAndStore('t1', 'u1', messages);
    expect(dbMock.insert).toHaveBeenCalled();
  });

  it('extractAndStore skips non-user messages', async () => {
    vi.clearAllMocks();
    const wm = new WorkingMemory();
    const messages = [
      { role: 'assistant', content: 'I noticed you like short responses' },
    ];
    await wm.extractAndStore('t1', 'u1', messages);
    expect(dbMock.insert).not.toHaveBeenCalled();
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
    mockAll.mockImplementationOnce(() => Promise.resolve([]));
    const wm = new WorkingMemory();
    const prompt = await wm.retrieveAsPrompt('t1', 'u1');
    expect(prompt).toBe('');
  });
});
