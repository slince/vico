// default-processors.test.ts — tests for context processors and onion pipeline
import {describe, expect, it, vi} from 'vitest';
import {z} from 'zod';
import {SystemPromptProcessor} from '../agent-loop/context-processors/system-prompt-processor.js';
import {SkillProcessor} from '../agent-loop/context-processors/skill-processor.js';
import {MemoryProcessor} from '../agent-loop/context-processors/memory-processor.js';
import {RagProcessor} from '../agent-loop/context-processors/rag-processor.js';
import {
  buildModelRequest,
  type ContextProcessor,
  ModelRequestContext,
  Priority,
  ProcessorPipeline,
} from '../agent-loop/context-processors/context-processor.js';
import type {AgentRef} from '../agent-loop/context-processors/context-processor.js';

function makeConfig(): AgentRef {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    name: 'test',
    systemPrompt: 'You are a helpful assistant.',
    temperature: 0.7,
    maxTokens: 4096,
    maxSteps: 10,
  };
}

function makeCtx(overrides?: Partial<ModelRequestContext> & { threadId?: string }): ModelRequestContext {
  const { threadId, ...rest } = overrides ?? {};
  const defaultThread = { id: 't1', agentId: 'a1', userId: 'u1', createdAt: 0, updatedAt: 0 };
  return new ModelRequestContext({
    agent: makeConfig(),
    userMessage: { role: 'user', content: 'hello' },
    session: {
      thread: threadId ? { ...defaultThread, id: threadId } : defaultThread,
      turn: { id: 'turn1', threadId: threadId ?? 't1', status: 'running' as const, steps: 0, createdAt: 0 },
      scopeId: 'u1',
    },
    ...rest,
  });
}

function makeMemoryStore(overrides?: Record<string, unknown>) {
  return {
    conversationWindow: 20,
    conversation: { threadStore: {} as any, get: vi.fn(async () => []) },
    semantic: { search: vi.fn(async () => []), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
    working: {
      scope: 'user' as const,
      getTemplate: () => '# User Facts\n- **Name**:\n',
      get: vi.fn(async () => ''),
      set: vi.fn(),
    },
    rag: { search: vi.fn() },
    ...overrides,
  };
}

// --- SystemPromptProcessor ---

describe('SystemPromptProcessor', () => {
  it('sets systemPrompt from agent config', async () => {
    const p = new SystemPromptProcessor();
    const ctx = makeCtx();
    await p.process(ctx);
    expect(ctx.systemPrompt).toBe('You are a helpful assistant.');
  });
});

// --- SkillProcessor ---

describe('SkillProcessor', () => {
  const skill = {
    name: 'code-review',
    description: 'Review code',
    instructions: '',
    path: '/skills/cr',
    source: 'local' as const,
    userInvocable: false,
    references: [],
    scripts: [],
    assets: [],
  };

  it('appends skill catalog to system prompt', async () => {
    const p = new SkillProcessor([skill]);
    const ctx = makeCtx();
    ctx.systemPrompt = 'Base prompt.';
    await p.process(ctx);
    expect(ctx.systemPrompt).toContain('Base prompt.');
    expect(ctx.systemPrompt).toContain('<available_skills>');
    expect(ctx.systemPrompt).toContain('code-review');
  });

  it('does nothing when catalog is empty', async () => {
    const p = new SkillProcessor([]);
    const ctx = makeCtx();
    ctx.systemPrompt = 'Base prompt.';
    await p.process(ctx);
    expect(ctx.systemPrompt).toBe('Base prompt.');
  });
});

// --- MemoryProcessor ---

describe('MemoryProcessor', () => {
  it('injects conversation history', async () => {
    const memoryStore = makeMemoryStore({
      conversation: { threadStore: {} as any, get: vi.fn(async () => [{ role: 'user' as const, content: 'previous msg' }]) },
    });
    const p = new MemoryProcessor(memoryStore);
    const ctx = makeCtx();
    ctx.messages = [{ role: 'user', content: 'current msg' }];
    await p.process(ctx);
    expect(ctx.messages[0]).toMatchObject({ role: 'user', content: 'previous msg' });
    expect(memoryStore.conversation.get).toHaveBeenCalledWith('t1', 20);
  });

  it('skip conversation injection when conversation not configured', async () => {
    const memoryStore = makeMemoryStore({ conversation: undefined });
    const p = new MemoryProcessor(memoryStore);
    const ctx = makeCtx();
    await p.process(ctx);
    // 仅用户消息 + 工作记忆注入，不含会话历史
    expect(ctx.messages).toHaveLength(2);
    expect(ctx.messages[0].role).toBe('user');
    expect(ctx.messages[1]).toMatchObject({ role: 'system', content: expect.stringContaining('updateWorkingMemory') });
  });

  it('appends memory results as system message', async () => {
    const memoryStore = makeMemoryStore({
      semantic: {
        search: vi.fn(async () => [
          { id: 'm1', content: 'user prefers dark mode', createdAt: 1 },
        ]),
        create: vi.fn(), update: vi.fn(), delete: vi.fn(),
      },
    });
    const p = new MemoryProcessor(memoryStore);
    const ctx = makeCtx();
    ctx.messages = [{ role: 'user', content: 'what theme do I use?' }];
    await p.process(ctx);
    expect(ctx.messages.some((m) => m.role === 'system' && m.content.includes('dark mode'))).toBe(true);
    expect(memoryStore.semantic.search).toHaveBeenCalledWith('what theme do I use?', 5);
  });

  it('no-op when no user message found for semantic search', async () => {
    const memoryStore = makeMemoryStore();
    const p = new MemoryProcessor(memoryStore);
    const ctx = makeCtx();
    ctx.messages = [{ role: 'system', content: 'system only' }];
    await p.process(ctx);
    expect(memoryStore.semantic.search).not.toHaveBeenCalled();
  });

  it('injects working memory template + data as system message', async () => {
    const memoryStore = makeMemoryStore({
      working: {
        scope: 'user' as const,
        getTemplate: () => '# User Facts\n- **Name**:\n- **Location**:\n',
        get: vi.fn(async () => ''),
        set: vi.fn(),
      },
    });
    const p = new MemoryProcessor(memoryStore);
    const ctx = makeCtx();
    await p.process(ctx);
    const wmMsg = ctx.messages.find((m) => m.role === 'system' && m.content.includes('updateWorkingMemory'));
    expect(wmMsg).toBeDefined();
    expect(wmMsg!.content).toContain('updateWorkingMemory');
    expect(wmMsg!.content).toContain('# User Facts');
  });

  it('injects existing working memory data when present', async () => {
    const memoryStore = makeMemoryStore({
      working: {
        scope: 'user' as const,
        getTemplate: () => '# User Facts\n- **Name**:\n- **Location**:\n',
        get: vi.fn(async () => '- **Name**: Alice\n- **Location**: Shanghai'),
        set: vi.fn(),
      },
    });
    const p = new MemoryProcessor(memoryStore);
    const ctx = makeCtx();
    await p.process(ctx);
    const wmMsg = ctx.messages.find((m) => m.role === 'system' && m.content.includes('updateWorkingMemory'));
    expect(wmMsg!.content).toContain('Alice');
    expect(memoryStore.working.get).toHaveBeenCalledWith('u1');
  });

  it('skips working memory injection when scopeId is empty', async () => {
    const memoryStore = makeMemoryStore();
    const p = new MemoryProcessor(memoryStore);
    const ctx = makeCtx({ scopeId: '' });
    ctx.messages = [{ role: 'user', content: 'hello' }];
    await p.process(ctx);
    const wmMsg = ctx.messages.find((m) => m.content.includes('updateWorkingMemory'));
    expect(wmMsg).toBeUndefined();
  });

  it('resolve() extracts facts from assistant messages into semantic memory', async () => {
    const memoryStore = makeMemoryStore({
      semantic: { search: vi.fn(async () => []), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
    });
    const p = new MemoryProcessor(memoryStore);
    const ctx = makeCtx();
    ctx.messages = [
      { role: 'user', content: 'My name is Alice and I live in Shanghai.' },
      { role: 'assistant', content: 'Nice to meet you, Alice! I will remember that you live in Shanghai.\nYour name is Alice.\nYou are located in Shanghai.' },
    ];
    await p.process(ctx);
    // resolve 应提取助理回复中的事实
    if (p.resolve) {
      await p.resolve(ctx);
    }
    const createCalls = (memoryStore.semantic.create as ReturnType<typeof vi.fn>).mock.calls;
    expect(createCalls.length).toBeGreaterThan(0);
    // 所有 fact 都应有 threadId 和 content
    for (const [record] of createCalls) {
      expect(record.content).toBeTruthy();
      expect(record.threadId).toBe('t1');
    }
  });

  it('resolve() skips non-assistant and short messages', async () => {
    const memoryStore = makeMemoryStore({
      semantic: { search: vi.fn(async () => []), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
    });
    const p = new MemoryProcessor(memoryStore);
    const ctx = makeCtx();
    ctx.messages = [
      { role: 'user', content: 'OK' },
      { role: 'assistant', content: 'Got it.' },
    ];
    await p.process(ctx);
    if (p.resolve) {
      await p.resolve(ctx);
    }
    expect(memoryStore.semantic.create).not.toHaveBeenCalled();
  });
});

// --- RagProcessor ---

describe('RagProcessor', () => {
  it('appends RAG results as system message', async () => {
    const ragProvider = { search: vi.fn(async () => [
      { content: 'important fact', score: 0.9, source: 'doc1' },
    ])};
    const p = new RagProcessor(ragProvider);
    const ctx = makeCtx();
    ctx.messages = [{ role: 'user', content: 'tell me about X' }];
    await p.process(ctx);
    expect(ctx.messages.some((m) => m.role === 'system' && m.content.includes('important fact'))).toBe(true);
    expect(ragProvider.search).toHaveBeenCalledWith('tell me about X', '', 5);
  });

  it('no-op when empty results', async () => {
    const ragProvider = { search: vi.fn(async () => []) };
    const p = new RagProcessor(ragProvider);
    const ctx = makeCtx();
    await p.process(ctx);
    expect(ctx.messages).toHaveLength(1);
  });
});

// --- OnionPipeline ---

describe('OnionPipeline', () => {
  it('runs processors in priority order', async () => {
    const order: string[] = [];
    const makeProcessor = (name: string, priority: number): ContextProcessor => ({
      name,
      priority,
      process: async () => { order.push(name); },
    });

    const pipeline = new ProcessorPipeline([
      makeProcessor('c', 100),
      makeProcessor('a', -100),
      makeProcessor('b', 0),
    ]);
    await pipeline.enter(makeCtx());
    expect(order).toEqual(['a', 'b', 'c']);
  });

  it('continues when a processor throws', async () => {
    const order: string[] = [];
    const throwing: ContextProcessor = {
      name: 'bad',
      priority: 0,
      process: async () => { throw new Error('boom'); },
    };
    const good: ContextProcessor = {
      name: 'good',
      priority: 10,
      process: async () => { order.push('good'); },
    };

    const pipeline = new ProcessorPipeline([throwing, good]);
    await pipeline.enter(makeCtx());
    expect(order).toEqual(['good']);
  });

  it('empty pipeline is a no-op', async () => {
    const pipeline = new ProcessorPipeline([]);
    const ctx = makeCtx();
    ctx.systemPrompt = 'original';
    await pipeline.enter(ctx);
    expect(ctx.systemPrompt).toBe('original');
    expect(ctx.messages).toHaveLength(1);
  });
});

// --- buildModelRequest ---

describe('buildModelRequest', () => {
  it('extracts streamText params from ModelRequestContext', () => {
    const config = makeConfig();
    const ctx = new ModelRequestContext({
      agent: config,
      systemPrompt: 'You are helpful.',
      messages: [{ role: 'user', content: 'hello' }],
      tools: [{ name: 'echo', description: '', inputSchema: z.object({}), policy: 'auto' as const, kind: 'command' as const, tags: [], execute: async () => {} }],
    });
    const req = buildModelRequest(ctx);
    expect(req.system).toBe('You are helpful.');
    expect(req.messages).toHaveLength(1);
    expect(req.tools).toHaveLength(1);
    expect(req.maxTokens).toBe(4096);
    expect(req.temperature).toBe(0.7);
  });

  it('omits system when empty', () => {
    const ctx = makeCtx();
    ctx.systemPrompt = '';
    const req = buildModelRequest(ctx);
    expect(req.system).toBeUndefined();
  });
});

// --- Priority constants ---

describe('Priority constants', () => {
  it('HIGH < NORMAL < LOW', () => {
    expect(Priority.HIGH).toBeLessThan(Priority.NORMAL);
    expect(Priority.NORMAL).toBeLessThan(Priority.LOW);
  });
});
