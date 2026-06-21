// agent-runtime.test.ts — tests for AgentRuntime: create, cache, LRU eviction, lifecycle
import { describe, it, expect, beforeEach } from 'vitest';
import { AgentRuntime } from '../agent-loop/agent-runtime.js';
import { Agent, type AgentFactory } from '../agent-loop/types.js';
import type { AgentConfig } from '../agent-loop/types.js';

function makeConfig(id: string): AgentConfig {
  return {
    id,
    name: `agent-${id}`,
    systemPrompt: 'test',
    model: { provider: 'openai', model: 'gpt-4o' },
    temperature: 0.7,
    maxTokens: 4096,
    maxSteps: 10,
  };
}

describe('AgentRuntime', () => {
  let factoryCallCount = 0;
  let runtime: AgentRuntime;

  const factory: AgentFactory = async (config) => {
    factoryCallCount++;
    return new Agent({ config, loopFactory: () => ({} as any) });
  };

  beforeEach(() => {
    factoryCallCount = 0;
    runtime = new AgentRuntime(factory, 10);
  });

  it('creates agent via factory', async () => {
    const agent = await runtime.createAgent(makeConfig('agent-1'));
    expect(agent.config.name).toBe('agent-agent-1');
    expect(factoryCallCount).toBe(1);
  });

  it('returns cached agent on second create', async () => {
    await runtime.createAgent(makeConfig('agent-1'));
    await runtime.createAgent(makeConfig('agent-1'));
    expect(factoryCallCount).toBe(1); // factory only called once
  });

  it('lists all agents', async () => {
    await runtime.createAgent(makeConfig('agent-1'));
    await runtime.createAgent(makeConfig('agent-2'));
    await runtime.createAgent(makeConfig('agent-3'));

    const agents = runtime.listAgents();
    expect(agents).toHaveLength(3);
  });

  it('destroys agent', async () => {
    await runtime.createAgent(makeConfig('agent-1'));
    await runtime.destroyAgent('agent-1');
    expect(runtime.getAgent('agent-1')).toBeUndefined();
  });

  it('updates agent config', async () => {
    await runtime.createAgent(makeConfig('agent-1'));
    const updated = await runtime.updateAgent('agent-1', { name: 'new-name' });
    expect(updated.config.name).toBe('new-name');
    expect(factoryCallCount).toBe(2); // re-created via factory
  });

  it('reloads agent', async () => {
    await runtime.createAgent(makeConfig('agent-1'));
    await runtime.reloadAgent('agent-1');
    expect(factoryCallCount).toBe(2);
  });

  it('evicts LRU when over capacity', async () => {
    const smallRuntime = new AgentRuntime(factory, 3);
    await smallRuntime.createAgent(makeConfig('agent-1'));
    await smallRuntime.createAgent(makeConfig('agent-2'));
    await smallRuntime.createAgent(makeConfig('agent-3'));
    await smallRuntime.createAgent(makeConfig('agent-4')); // triggers eviction

    // agent-1 should be evicted (oldest)
    expect(smallRuntime.getAgent('agent-1')).toBeUndefined();
    expect(smallRuntime.getAgent('agent-4')).toBeDefined();
  });

  it('isHealthy returns true for cached agent', async () => {
    await runtime.createAgent(makeConfig('agent-1'));
    expect(runtime.isHealthy('agent-1')).toBe(true);
    expect(runtime.isHealthy('agent-nonexistent')).toBe(false);
  });
});
