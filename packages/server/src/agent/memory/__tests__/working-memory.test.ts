import { describe, it, expect, vi } from 'vitest';

// vi.mock 会被提升到文件顶部，因此 mock 变量必须通过 vi.hoisted 定义
const { mockAll, mockDrizzleRun, dbMock, mockGenerateObject } = vi.hoisted(() => {
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
    select: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    run: mockDrizzleRun,
  };

  return { mockAll, mockDrizzleRun, dbMock, mockGenerateObject: vi.fn() };
});

// set up chainable mock returns
dbMock.select.mockReturnValue({
  from: vi.fn().mockReturnValue({
    where: vi.fn().mockReturnValue({
      orderBy: vi.fn().mockReturnValue({
        limit: vi.fn().mockReturnValue({
          all: mockAll,
          run: mockDrizzleRun,
        }),
      }),
      limit: vi.fn().mockReturnValue({
        all: mockAll,
        run: mockDrizzleRun,
      }),
      run: mockDrizzleRun,
      all: mockAll,
    }),
  }),
});

dbMock.insert.mockReturnValue({
  values: vi.fn().mockReturnValue({ run: mockDrizzleRun }),
});

dbMock.update.mockReturnValue({
  set: vi.fn().mockReturnValue({
    where: vi.fn().mockReturnValue({ run: mockDrizzleRun }),
  }),
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

vi.mock('ai', () => ({
  generateObject: mockGenerateObject,
}));

import { WorkingMemory } from '../working-memory.js';

/** 创建一个模拟的 LanguageModel（仅用于满足类型检查，generateObject 已被 mock） */
function mockModel() {
  return {} as unknown as import('ai').LanguageModel;
}

describe('WorkingMemory (LLM-based extraction)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // 恢复 mockAll 默认行为（返回预置的记忆条目）
    mockAll.mockImplementation(() =>
      Promise.resolve([
        {
          id: 'mem-id-1',
          tenant_id: 't1',
          user_id: 'u1',
          type: 'working',
          content: '用户偏好简洁回复',
          importance: 0.8,
          created_at: Date.now(),
        },
      ]),
    );
  });

  it('extractAndStore calls generateObject and stores extracted facts', async () => {
    mockGenerateObject.mockResolvedValueOnce({
      object: {
        facts: [
          { content: '用户偏好简洁回复', importance: 0.9 },
          { content: '用户在北京工作', importance: 0.5 },
        ],
      },
    });

    // upsertByContent 内部的 SELECT 需要返回空 → 走 INSERT 路径
    // 两个事实各自调用一次 upsertByContent，每次内部先 SELECT 查重
    mockAll.mockReturnValue(Promise.resolve([]));
    const wm = new WorkingMemory();
    const messages = [
      { role: 'user', content: '我喜欢简洁的回复方式，我在北京工作' },
    ];
    await wm.extractAndStore(mockModel(), 't1', 'u1', messages);

    // 验证 generateObject 被调用
    expect(mockGenerateObject).toHaveBeenCalledTimes(1);

    // 验证两个事实都被存储（各走一次 INSERT）
    expect(dbMock.insert).toHaveBeenCalledTimes(2);
  });

  it('extractAndStore skips storage when no facts extracted', async () => {
    vi.clearAllMocks();
    mockGenerateObject.mockResolvedValueOnce({
      object: { facts: [] },
    });

    const wm = new WorkingMemory();
    const messages = [
      { role: 'user', content: '今天天气怎么样？' },
    ];
    await wm.extractAndStore(mockModel(), 't1', 'u1', messages);

    // 不应插入任何数据
    expect(dbMock.insert).not.toHaveBeenCalled();
  });

  it('extractAndStore skips non-user messages', async () => {
    const wm = new WorkingMemory();
    const messages = [
      { role: 'assistant', content: 'I noticed you like short responses' },
    ];
    await wm.extractAndStore(mockModel(), 't1', 'u1', messages);

    // 无用户消息 → 不调用 generateObject
    expect(mockGenerateObject).not.toHaveBeenCalled();
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
