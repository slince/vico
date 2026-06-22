// contracts.test.ts — Zod schema validation tests for agent, tool, memory, and event contracts
import { describe, it, expect } from 'vitest';
import { AgentConfigSchema } from '../agent-loop/types.js';

import { MemoryRecordSchema } from '../memory/types.js';
describe('AgentConfigSchema', () => {
  it('parses valid config', () => {
    const result = AgentConfigSchema.safeParse({
      id: '00000000-0000-4000-8000-000000000001',
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


describe('MemoryRecordSchema', () => {
  it('parses valid memory record', () => {
    const result = MemoryRecordSchema.safeParse({
      id: '00000000-0000-4000-8000-000000000001',
      content: 'user prefers dark mode',
      createdAt: 1700000000000,
    });
    expect(result.success).toBe(true);
  });
});
