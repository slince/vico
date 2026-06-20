// default-processors.test.ts — tests for context processors and onion pipeline
import { describe, it, expect, vi } from 'vitest';
import { SystemPromptProcessor } from '../prompt/system-prompt-processor.js';
import { SkillCatalogProcessor } from '../skill/skill-catalog-processor.js';
import { MemoryProcessor } from '../memory/memory-processor.js';
import { RagProcessor } from '../memory/rag-processor.js';
import { DynamicInstructionProcessor } from '../agent-loop/dynamic-instruction-processor.js';
import {
  OnionPipeline,
  buildModelRequest,
  Priority,
  ModelRequestContext,
  type ContextProcessor,
} from '../prompt/context-processor.js';
import type { AgentConfig } from '../contracts/agent.js';

function makeConfig(): AgentConfig {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    name: 'test',
    systemPrompt: 'You are a helpful assistant.',
    model: { provider: 'openai', model: 'gpt-4o' },
    temperature: 0.7,
    maxTokens: 4096,
    maxSteps: 10,
  };
}

function makeCtx(overrides?: Partial<ModelRequestContext>): ModelRequestContext {
  return new ModelRequestContext({
    agent: makeConfig(),
    messages: [{ role: 'user', content: 'hello' }],
    ...overrides,
  });
}

describe('SystemPromptProcessor', () => {
  it('sets systemPrompt from agent config', async () => {
    const p = new SystemPromptProcessor();
    const ctx = makeCtx();
    await p.process(ctx);
    expect(ctx.systemPrompt).toBe('You are a helpful assistant.');
  });
});

describe('SkillCatalogProcessor', () => {
  it('appends skill catalog to system prompt', async () => {
    const p = new SkillCatalogProcessor([
      { name: 'code-review', description: 'Review code', location: '/skills/cr' },
    ]);
    const ctx = makeCtx();
    ctx.systemPrompt = 'Base prompt.';
    await p.process(ctx);
    expect(ctx.systemPrompt).toContain('Base prompt.');
    expect(ctx.systemPrompt).toContain('<available_skills>');
    expect(ctx.systemPrompt).toContain('code-review');
  });

  it('does nothing when catalog is empty', async () => {
    const p = new SkillCatalogProcessor([]);
    const ctx = makeCtx();
    ctx.systemPrompt = 'Base prompt.';
    await p.process(ctx);
    expect(ctx.systemPrompt).toBe('Base prompt.');
  });
});

describe('MemoryProcessor', () => {
  it('appends memory results as system message', async () => {
    const memoryStore = {
      stm: { push: vi.fn(), get: vi.fn(() => []) },
      ltm: {
        search: vi.fn(async () => [
          { id: 'm1', content: 'user prefers dark mode', createdAt: 1 },
        ]),
        create: vi.fn(), update: vi.fn(), delete: vi.fn(),
      },
      rag: { search: vi.fn(async () => []) },
    };
    const p = new MemoryProcessor(memoryStore);
    const ctx = makeCtx();
    ctx.messages = [{ role: 'user', content: 'what theme do I use?' }];
    await p.process(ctx);
    expect(ctx.messages.some((m) => m.role === 'system' && m.content.includes('dark mode'))).toBe(true);
    expect(memoryStore.ltm.search).toHaveBeenCalledWith('what theme do I use?', 5);
  });

  it('no-op when no user message found', async () => {
    const memoryStore = {
      stm: { push: vi.fn(), get: vi.fn(() => []) },
      ltm: { search: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
      rag: { search: vi.fn() },
    };
    const p = new MemoryProcessor(memoryStore);
    const ctx = makeCtx();
    ctx.messages = [{ role: 'system', content: 'system only' }];
    await p.process(ctx);
    expect(memoryStore.ltm.search).not.toHaveBeenCalled();
  });
});

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

describe('DynamicInstructionProcessor', () => {
  it('appends instructions as system message', async () => {
    const getInstructions = () => ['hint1', 'hint2'];
    const p = new DynamicInstructionProcessor(getInstructions);
    const ctx = makeCtx();
    await p.process(ctx);
    expect(ctx.messages.some((m) => m.role === 'system' && m.content.includes('hint1\nhint2'))).toBe(true);
  });

  it('no-op when instructions empty', async () => {
    const getInstructions = () => [];
    const p = new DynamicInstructionProcessor(getInstructions);
    const ctx = makeCtx();
    await p.process(ctx);
    expect(ctx.messages).toHaveLength(1);
  });
});

describe('OnionPipeline', () => {
  it('runs processors in priority order', async () => {
    const order: string[] = [];
    const makeProcessor = (name: string, priority: number): ContextProcessor => ({
      name,
      priority,
      process: async () => { order.push(name); },
    });

    const pipeline = new OnionPipeline([
      makeProcessor('c', 100),
      makeProcessor('a', -100),
      makeProcessor('b', 0),
    ]);
    await pipeline.run(makeCtx());
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

    const pipeline = new OnionPipeline([throwing, good]);
    await pipeline.run(makeCtx());
    expect(order).toEqual(['good']);
  });

  it('empty pipeline is a no-op', async () => {
    const pipeline = new OnionPipeline([]);
    const ctx = makeCtx();
    ctx.systemPrompt = 'original';
    await pipeline.run(ctx);
    expect(ctx.systemPrompt).toBe('original');
    expect(ctx.messages).toHaveLength(1);
  });
});

describe('buildModelRequest', () => {
  it('converts ModelRequestContext to ModelRequest', () => {
    const config = makeConfig();
    const ctx = new ModelRequestContext({
      agent: config,
      systemPrompt: 'You are helpful.',
      messages: [{ role: 'user', content: 'hello' }],
      tools: [{ name: 'echo', description: '', inputSchema: {}, policy: 'auto', kind: 'command' }],
    });
    const req = buildModelRequest(ctx);
    expect(req.system).toBe('You are helpful.');
    expect(req.messages).toHaveLength(1);
    expect(req.tools).toHaveLength(1);
    expect(req.maxTokens).toBe(4096);
    expect(req.temperature).toBe(0.7);
    expect(req.abortSignal).toBeDefined();
  });

  it('omits system when empty', () => {
    const ctx = makeCtx();
    ctx.systemPrompt = '';
    const req = buildModelRequest(ctx);
    expect(req.system).toBeUndefined();
  });
});

describe('Priority constants', () => {
  it('HIGH < NORMAL < LOW', () => {
    expect(Priority.HIGH).toBeLessThan(Priority.NORMAL);
    expect(Priority.NORMAL).toBeLessThan(Priority.LOW);
  });
});
