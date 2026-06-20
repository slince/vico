// contracts.test.ts — Zod schema validation tests for agent, tool, memory, and event contracts
import { describe, it, expect } from 'vitest';
import { AgentConfigSchema } from '../contracts/agent.js';
import { ToolSpecSchema } from '../contracts/tool.js';
import { MemoryRecordSchema } from '../contracts/memory.js';
import { SSEEventSchema } from '../contracts/events.js';

describe('AgentConfigSchema', () => {
  it('parses valid config', () => {
    const result = AgentConfigSchema.safeParse({
      id: '00000000-0000-4000-8000-000000000001',
      tenantId: 'tenant-1',
      name: 'test-agent',
      systemPrompt: 'You are helpful.',
      model: { provider: 'openai', model: 'gpt-4o' },
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing required fields', () => {
    const result = AgentConfigSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('applies defaults', () => {
    const result = AgentConfigSchema.safeParse({
      id: '00000000-0000-4000-8000-000000000001',
      tenantId: 'tenant-1',
      name: 'test',
      model: { provider: 'openai', model: 'gpt-4o' },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.temperature).toBe(0.7);
      expect(result.data.maxSteps).toBe(10);
    }
  });
});

describe('ToolSpecSchema', () => {
  it('parses valid tool spec', () => {
    const result = ToolSpecSchema.safeParse({
      name: 'search',
      description: 'Search the web',
      inputSchema: { type: 'object', properties: { q: { type: 'string' } } },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.policy).toBe('auto');
    }
  });
});

describe('MemoryRecordSchema', () => {
  it('parses valid memory record', () => {
    const result = MemoryRecordSchema.safeParse({
      id: '00000000-0000-4000-8000-000000000001',
      tenantId: 't1',
      content: 'user prefers dark mode',
      createdAt: 1700000000000,
    });
    expect(result.success).toBe(true);
  });
});

describe('SSEEventSchema', () => {
  it('parses text_delta event', () => {
    const result = SSEEventSchema.safeParse({ type: 'text_delta', content: 'hello' });
    expect(result.success).toBe(true);
  });

  it('parses done event', () => {
    const result = SSEEventSchema.safeParse({
      type: 'done',
      usage: { input: 100, output: 50 },
    });
    expect(result.success).toBe(true);
  });

  it('rejects unknown event type', () => {
    const result = SSEEventSchema.safeParse({ type: 'unknown' });
    expect(result.success).toBe(false);
  });
});
