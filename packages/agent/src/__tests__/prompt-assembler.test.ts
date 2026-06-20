// prompt-assembler.test.ts — tests for PromptAssembler system prompt assembly
import { describe, it, expect } from 'vitest';
import { PromptAssembler } from '../prompt/assembler.js';
import type { AgentConfig } from '../contracts/agent.js';

function makeConfig(overrides?: Partial<AgentConfig>): AgentConfig {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    name: 'test',
    systemPrompt: 'You are a helpful assistant.',
    model: { provider: 'openai', model: 'gpt-4o' },
    temperature: 0.7,
    maxTokens: 4096,
    maxSteps: 10,
    ...overrides,
  };
}

describe('PromptAssembler', () => {
  it('assembles system prompt + history', () => {
    const assembler = new PromptAssembler();
    const req = assembler.assemble({
      agent: makeConfig(),
      skillCatalog: [],
      memoryItems: [],
      ragResults: [],
      history: [{ role: 'user', content: 'hi' }],
      tools: [],
      dynamicInstructions: [],
    });

    expect(req.system).toContain('You are a helpful assistant.');
    expect(req.messages).toHaveLength(1);
    expect(req.messages[0].content).toBe('hi');
  });

  it('includes skill catalog in system prompt', () => {
    const assembler = new PromptAssembler();
    const req = assembler.assemble({
      agent: makeConfig(),
      skillCatalog: [
        { name: 'code-review', description: 'Review code', location: '/skills/code-review' },
      ],
      memoryItems: [],
      ragResults: [],
      history: [],
      tools: [],
      dynamicInstructions: [],
    });

    expect(req.system).toContain('<available_skills>');
    expect(req.system).toContain('code-review');
  });

  it('puts dynamic context after history', () => {
    const assembler = new PromptAssembler();
    const req = assembler.assemble({
      agent: makeConfig(),
      skillCatalog: [],
      memoryItems: [{ id: '00000000-0000-4000-8000-000000000001', content: 'remember this', createdAt: 1 }],
      ragResults: [],
      history: [{ role: 'user', content: 'hi' }],
      tools: [],
      dynamicInstructions: ['extra hint'],
    });

    // history[0] = user message, history[1] = memory system message, history[2] = dynamic instruction
    expect(req.messages).toHaveLength(3);
    expect(req.messages[0].content).toBe('hi');
    expect(req.messages[1].content).toContain('remember this');
    expect(req.messages[2].content).toBe('extra hint');
  });

  it('includes rag results after memory items', () => {
    const assembler = new PromptAssembler();
    const req = assembler.assemble({
      agent: makeConfig(),
      skillCatalog: [],
      memoryItems: [{ id: '00000000-0000-4000-8000-000000000001', content: 'remember this', createdAt: 1 }],
      ragResults: [{ content: 'rag content', score: 0.9, source: 'doc1' }],
      history: [{ role: 'user', content: 'hi' }],
      tools: [],
      dynamicInstructions: [],
    });

    expect(req.messages).toHaveLength(3);
    expect(req.messages[1].content).toContain('remember this');
    expect(req.messages[2].content).toContain('rag content');
  });
});
