import { describe, expect, it, vi } from 'vitest';
import { InMemoryThreadStore, toModelMessages } from '@vico/thread';
import type { ModelClient } from '@vico/model';
import { ManualCompactionError, TargetPressureConfigError, isContextOverflowError } from './errors.js';
import { ModelContextCompactor } from './model-context-compactor.js';
import type { CompactionContext } from './types.js';

/** parts 数组 → ReadableStream（Node 类型无 ReadableStream.from，手动包装） */
function streamOf(parts: unknown[]): ReadableStream<unknown> {
  return new ReadableStream({
    start(controller) { for (const p of parts) controller.enqueue(p); controller.close(); },
  });
}

/** 摘要返回 "compacted summary text" 的假 ModelClient */
function fakeClient(): ModelClient {
  return {
    stream: vi.fn(async () => {
      const parts = [{ type: 'text-delta', delta: 'compacted summary text' }];
      return { stream: streamOf(parts), text: async () => 'compacted summary text' };
    }),
  } as unknown as ModelClient;
}

/** 以 store 非归档条目构建压缩上下文（等价于 turn 开始前的历史注入；turn 模拟「当前 turn」） */
async function makeContext(store: InMemoryThreadStore, threadId: string, client: ModelClient): Promise<CompactionContext> {
  const thread = (await store.getThread(threadId))!;
  const turn = await store.createTurn(threadId);
  const messages = toModelMessages(await store.getEntries(threadId, { includeArchived: false }));
  return {
    messages,
    historyCount: messages.length,
    session: { thread, turn },
    modelClient: client,
    signal: new AbortController().signal,
  };
}

/** 读取线程非归档消息为压缩候选（手动压缩路径的候选来源） */
async function getMessages(store: InMemoryThreadStore, threadId: string) {
  return toModelMessages(await store.getEntries(threadId, { includeArchived: false }));
}

/** 造一个 thread + 若干 completed turn（每条一条长文本 user 消息，保证 head token 足够大以通过 shrink check） */
async function seed(store: InMemoryThreadStore, texts: string[]): Promise<void> {
  await store.createThread('agent', 't', 'thread-1');
  // createdAt 显式递增，避免同毫秒创建导致 getRecentTurns 的倒序假设失效
  let createdAt = 1000;
  for (const text of texts) {
    const turn = await store.createTurn('thread-1');
    await store.appendEntries([{ threadId: 'thread-1', turnId: turn.id, role: 'user', content: text }]);
    await store.updateTurn(turn.id, { status: 'completed', createdAt: createdAt++ });
  }
}

describe('isContextOverflowError', () => {
  it('匹配典型超限错误', () => {
    expect(isContextOverflowError(new Error('maximum context length exceeded'))).toBe(true);
    expect(isContextOverflowError(new Error('context_length_exceeded'))).toBe(true);
    expect(isContextOverflowError({ statusCode: 400, message: 'context length' })).toBe(true);
    expect(isContextOverflowError(new Error('network error'))).toBe(false);
  });
});

describe('ModelContextCompactor', () => {
  it('pressure 无 contextWindow 时抛 TargetPressureConfigError', async () => {
    const store = new InMemoryThreadStore();
    await seed(store, ['hello']);
    const c = new ModelContextCompactor({ thread: store, conversationWindow: 10 });
    await expect(c.compactIfNeeded(
      await makeContext(store, 'thread-1', fakeClient()),
      'pressure',
    )).rejects.toThrow(TargetPressureConfigError);
  });

  it('compactNow 无 contextWindow 时抛 TargetPressureConfigError（HTTP 层据此映射 400 而非 500）', async () => {
    const store = new InMemoryThreadStore();
    await seed(store, ['hello']);
    const c = new ModelContextCompactor({ thread: store, conversationWindow: 10 });
    await expect(c.compactNow(
      (await store.getThread('thread-1'))!,
      await getMessages(store, 'thread-1'),
      fakeClient(),
      new AbortController().signal,
    )).rejects.toThrow(TargetPressureConfigError);
  });

  it('配置独立摘要模型但无 modelConfig 时抛 ManualCompactionError(summary)', async () => {
    const store = new InMemoryThreadStore();
    await seed(store, ['x'.repeat(1000), 'y'.repeat(1000)]);
    const c = new ModelContextCompactor({
      thread: store,
      conversationWindow: 10,
      // 无 modelConfig，但配置了独立摘要模型
      settings: { retainTokens: 1, summarizationProvider: 'openai', summarizationModel: 'gpt-mini' },
    });
    // context-overflow 不校验 contextWindow，是唯一能触达 resolveSummaryClient 缺 modelConfig 分支的 trigger
    const err = await c.compactIfNeeded(await makeContext(store, 'thread-1', fakeClient()), 'context-overflow').catch((e) => e);
    expect(err).toBeInstanceOf(ManualCompactionError);
    expect((err as ManualCompactionError).code).toBe('summary');
  });
});

describe('ModelContextCompactor 集成', () => {
  it('compactNow 压缩除保留尾部外的 completed turn，历史只含摘要+尾部', async () => {
    const store = new InMemoryThreadStore();
    // 长文本保证 head token（约 516）明显大于摘要（约 42），shrink check 通过
    await seed(store, ['x'.repeat(1000), 'y'.repeat(1000), 'z'.repeat(1000)]);
    const thread = (await store.getThread('thread-1'))!;
    const c = new ModelContextCompactor({
      thread: store,
      conversationWindow: 10,
      modelConfig: { provider: 'openai', model: 'gpt', apiKey: 'k', contextWindow: 100000 },
      settings: { retainTokens: 1 }, // 只保留最后 1 turn
    });

    const result = await c.compactNow(thread, await getMessages(store, 'thread-1'), fakeClient(), new AbortController().signal);
    expect(result).not.toBeNull();
    expect(result!.archivedTurnIds).toHaveLength(2); // 前两个 turn 被归档

    // 摘要消息已写入，role='summary'
    const summaries = await store.getEntries('thread-1', { roles: ['summary'], includeArchived: false });
    expect(summaries).toHaveLength(1);
    expect(summaries[0].content).toContain('compacted summary text');

    // 非归档消息 = 1 条摘要 + 尾部 turn（z）
    const active = await store.getEntries('thread-1', { includeArchived: false });
    const nonSummary = active.filter((m) => m.role !== 'summary');
    expect(nonSummary.map((m) => m.content)).toEqual(['z'.repeat(1000)]);
  });

  it('摘要 LLM 失败时直接抛错：不写摘要、不归档', async () => {
    const store = new InMemoryThreadStore();
    await seed(store, ['x'.repeat(1000), 'y'.repeat(1000), 'z'.repeat(1000)]);
    const thread = (await store.getThread('thread-1'))!;
    const failingClient = {
      stream: vi.fn(async () => { throw new Error('boom'); }),
    } as unknown as ModelClient;
    const c = new ModelContextCompactor({
      thread: store,
      conversationWindow: 10,
      modelConfig: { provider: 'openai', model: 'gpt', apiKey: 'k', contextWindow: 100000 },
      settings: { retainTokens: 1 },
    });
    await expect(c.compactNow(thread, await getMessages(store, 'thread-1'), failingClient, new AbortController().signal)).rejects.toThrow('boom');
    expect(await store.getEntries('thread-1', { roles: ['summary'] })).toHaveLength(0); // 未写摘要
    expect(await store.getEntries('thread-1', { includeArchived: false })).toHaveLength(3); // 全量未归档
  });

  it('摘要输出为空时 no-op：不写摘要、不归档', async () => {
    const store = new InMemoryThreadStore();
    await seed(store, ['x'.repeat(1000), 'y'.repeat(1000), 'z'.repeat(1000)]);
    const thread = (await store.getThread('thread-1'))!;
    const emptyClient = {
      stream: vi.fn(async () => ({ stream: streamOf([]), text: async () => '' })),
    } as unknown as ModelClient;
    const c = new ModelContextCompactor({
      thread: store,
      conversationWindow: 10,
      modelConfig: { provider: 'openai', model: 'gpt', apiKey: 'k', contextWindow: 100000 },
      settings: { retainTokens: 1 },
    });
    const result = await c.compactNow(thread, await getMessages(store, 'thread-1'), emptyClient, new AbortController().signal);
    expect(result).toBeNull();
    expect(await store.getEntries('thread-1', { roles: ['summary'] })).toHaveLength(0);
    expect(await store.getEntries('thread-1', { includeArchived: false })).toHaveLength(3);
  });

  it('摘要不小于被压缩内容时 no-op：不写摘要、不归档（shrink check）', async () => {
    const store = new InMemoryThreadStore();
    await seed(store, ['x'.repeat(1000), 'y'.repeat(1000), 'z'.repeat(1000)]);
    const thread = (await store.getThread('thread-1'))!;
    // 返回超长摘要（约 3000 chars ≈ 754 tokens）大于 head（约 516），触发 shrink check 失败
    const hugeClient = {
      stream: vi.fn(async () => {
        const huge = 'A'.repeat(3000);
        const parts = [{ type: 'text-delta', delta: huge }];
        return { stream: streamOf(parts), text: async () => huge };
      }),
    } as unknown as ModelClient;
    const c = new ModelContextCompactor({
      thread: store,
      conversationWindow: 10,
      modelConfig: { provider: 'openai', model: 'gpt', apiKey: 'k', contextWindow: 100000 },
      settings: { retainTokens: 1 },
    });
    const result = await c.compactNow(thread, await getMessages(store, 'thread-1'), hugeClient, new AbortController().signal);
    expect(result).toBeNull();
    expect(await store.getEntries('thread-1', { roles: ['summary'] })).toHaveLength(0);
    expect(await store.getEntries('thread-1', { includeArchived: false })).toHaveLength(3);
  });

  it('旧摘要作为普通 head 消息参与压缩：大旧摘要 + 小 head 时合法压缩不被误拒', async () => {
    const store = new InMemoryThreadStore();
    await seed(store, ['x'.repeat(400), 'y'.repeat(400), 'z'.repeat(400), 'w'.repeat(400), 'v'.repeat(400)]);
    const thread = (await store.getThread('thread-1'))!;
    const c = new ModelContextCompactor({
      thread: store,
      conversationWindow: 10,
      modelConfig: { provider: 'openai', model: 'gpt', apiKey: 'k', contextWindow: 100000 },
      settings: { retainTokens: 1 },
    });

    // 第一次压缩：head = [x,y,z,w]，产生摘要（挂到尾部 v 的 turn）
    const bigClient = {
      stream: vi.fn(async () => ({ stream: streamOf([{ type: 'text-delta', delta: 'B'.repeat(1000) }]), text: async () => 'B'.repeat(1000) })),
    } as unknown as ModelClient;
    expect(await c.compactNow(thread, await getMessages(store, 'thread-1'), bigClient, new AbortController().signal)).not.toBeNull();

    // 追加一条短 turn，使其成为唯一保留的 tail，旧摘要与 v 一起成为 head
    const turn = await store.createTurn('thread-1');
    await store.appendEntries([{ threadId: 'thread-1', turnId: turn.id, role: 'user', content: 'q'.repeat(100) }]);
    await store.updateTurn(turn.id, { status: 'completed', createdAt: 99999 });

    // 第二次压缩：head 含旧摘要（约 272 token）+ v（约 108 token），新摘要约 218 token 小于 head，通过 shrink check
    const smallClient = {
      stream: vi.fn(async () => ({ stream: streamOf([{ type: 'text-delta', delta: 'C'.repeat(600) }]), text: async () => 'C'.repeat(600) })),
    } as unknown as ModelClient;
    const second = await c.compactNow(thread, await getMessages(store, 'thread-1'), smallClient, new AbortController().signal);
    expect(second).not.toBeNull();
  });
});
