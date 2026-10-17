import { describe, expect, it, vi } from 'vitest';
import { InMemoryThreadStore } from '@vico/thread';
import type { ModelClient } from '@vico/model';
import { ManualCompactionError, TargetPressureConfigError, isContextOverflowError } from './errors.js';
import { ModelContextCompactor } from './model-context-compactor.js';

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
      return { stream: streamOf(parts), readText: async () => 'compacted summary text' };
    }),
  } as unknown as ModelClient;
}

/** 造一个 thread + 若干 completed turn（每条一条长文本 user 消息，保证 head token 足够大以通过 shrink check） */
async function seed(store: InMemoryThreadStore, texts: string[]): Promise<void> {
  await store.createThread('agent', 't', 'thread-1');
  // createdAt 显式递增，避免同毫秒创建导致 getRecentTurns 的倒序假设失效
  let createdAt = 1000;
  for (const text of texts) {
    const turn = await store.createTurn('thread-1');
    await store.appendEntries([{ threadId: 'thread-1', turnId: turn.id, role: 'user', content: JSON.stringify(text) }]);
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
      (await store.getThread('thread-1'))!,
      fakeClient(),
      'pressure',
      new AbortController().signal,
    )).rejects.toThrow(TargetPressureConfigError);
  });

  it('compactNow 无 contextWindow 时抛 TargetPressureConfigError（HTTP 层据此映射 400 而非 500）', async () => {
    const store = new InMemoryThreadStore();
    await seed(store, ['hello']);
    const c = new ModelContextCompactor({ thread: store, conversationWindow: 10 });
    await expect(c.compactNow(
      (await store.getThread('thread-1'))!,
      fakeClient(),
      new AbortController().signal,
    )).rejects.toThrow(TargetPressureConfigError);
  });

  it('配置独立摘要模型但无 modelConfig 时抛 ManualCompactionError(summary)', async () => {
    const store = new InMemoryThreadStore();
    await seed(store, ['x'.repeat(1000), 'y'.repeat(1000)]);
    const thread = (await store.getThread('thread-1'))!;
    const c = new ModelContextCompactor({
      thread: store,
      conversationWindow: 10,
      // 无 modelConfig，但配置了独立摘要模型
      settings: { retainTokens: 1, summarizationProvider: 'openai', summarizationModel: 'gpt-mini' },
    });
    // context-overflow 不校验 contextWindow，是唯一能触达 resolveSummaryClient 缺 modelConfig 分支的 trigger
    const err = await c.compactIfNeeded(thread, fakeClient(), 'context-overflow', new AbortController().signal).catch((e) => e);
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

    const result = await c.compactNow(thread, fakeClient(), new AbortController().signal);
    expect(result).not.toBeNull();
    expect(result!.archivedTurnIds).toHaveLength(2); // 前两个 turn 被归档

    // 摘要消息已写入，role='summary'
    const summaries = await store.getEntries('thread-1', { roles: ['summary'], includeArchived: false });
    expect(summaries).toHaveLength(1);
    expect(JSON.parse(summaries[0].content)).toContain('compacted summary text');

    // 非归档消息 = 1 条摘要 + 尾部 turn（z）
    const active = await store.getEntries('thread-1', { includeArchived: false });
    const nonSummary = active.filter((m) => m.role !== 'summary');
    expect(nonSummary.map((m) => JSON.parse(m.content))).toEqual(['z'.repeat(1000)]);
  });

  it('摘要 LLM 失败时 no-op：不写摘要、不归档', async () => {
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
    const result = await c.compactNow(thread, failingClient, new AbortController().signal);
    expect(result).toBeNull(); // 失败 no-op，下次 turn 再试
    expect(await store.getEntries('thread-1', { roles: ['summary'] })).toHaveLength(0); // 未写摘要
    expect(await store.getEntries('thread-1', { includeArchived: false })).toHaveLength(3); // 全量未归档
  });

  it('摘要输出为空时 no-op：不写摘要、不归档', async () => {
    const store = new InMemoryThreadStore();
    await seed(store, ['x'.repeat(1000), 'y'.repeat(1000), 'z'.repeat(1000)]);
    const thread = (await store.getThread('thread-1'))!;
    const emptyClient = {
      stream: vi.fn(async () => ({ stream: streamOf([]), readText: async () => '' })),
    } as unknown as ModelClient;
    const c = new ModelContextCompactor({
      thread: store,
      conversationWindow: 10,
      modelConfig: { provider: 'openai', model: 'gpt', apiKey: 'k', contextWindow: 100000 },
      settings: { retainTokens: 1 },
    });
    const result = await c.compactNow(thread, emptyClient, new AbortController().signal);
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
        return { stream: streamOf(parts), readText: async () => huge };
      }),
    } as unknown as ModelClient;
    const c = new ModelContextCompactor({
      thread: store,
      conversationWindow: 10,
      modelConfig: { provider: 'openai', model: 'gpt', apiKey: 'k', contextWindow: 100000 },
      settings: { retainTokens: 1 },
    });
    const result = await c.compactNow(thread, hugeClient, new AbortController().signal);
    expect(result).toBeNull();
    expect(await store.getEntries('thread-1', { roles: ['summary'] })).toHaveLength(0);
    expect(await store.getEntries('thread-1', { includeArchived: false })).toHaveLength(3);
  });

  it('shrink check 基线含旧摘要：旧摘要大 + head 小时合法压缩不被误拒', async () => {
    const store = new InMemoryThreadStore();
    await seed(store, ['x'.repeat(400), 'y'.repeat(400), 'z'.repeat(400), 'w'.repeat(400), 'v'.repeat(400)]);
    const thread = (await store.getThread('thread-1'))!;
    const c = new ModelContextCompactor({
      thread: store,
      conversationWindow: 10,
      modelConfig: { provider: 'openai', model: 'gpt', apiKey: 'k', contextWindow: 100000 },
      settings: { retainTokens: 1 },
    });

    // 第一次压缩产生旧摘要（约 286 token，head 432 > 286 通过 shrink check）
    const bigClient = {
      stream: vi.fn(async () => ({ stream: streamOf([{ type: 'text-delta', delta: 'B'.repeat(1000) }]), readText: async () => 'B'.repeat(1000) })),
    } as unknown as ModelClient;
    expect(await c.compactNow(thread, bigClient, new AbortController().signal)).not.toBeNull();

    // 追加一条短 turn 作新 head（33 token），旧摘要约 290 token
    const turn = await store.createTurn('thread-1');
    await store.appendEntries([{ threadId: 'thread-1', turnId: turn.id, role: 'user', content: JSON.stringify('q'.repeat(100)) }]);
    await store.updateTurn(turn.id, { status: 'completed', createdAt: 99999 });

    // 第二次压缩：新摘要约 186 token（>= head 33 但 < head+旧摘要 398）
    const smallClient = {
      stream: vi.fn(async () => ({ stream: streamOf([{ type: 'text-delta', delta: 'C'.repeat(600) }]), readText: async () => 'C'.repeat(600) })),
    } as unknown as ModelClient;
    const second = await c.compactNow(thread, smallClient, new AbortController().signal);
    expect(second).not.toBeNull(); // 修复前基线仅 head（33），186 >= 33 被误拒为 null
  });
});
