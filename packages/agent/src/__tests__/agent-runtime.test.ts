// agent-runtime.test.ts — tests for AgentRuntimeImpl: create, cache, LRU eviction, lifecycle
import { describe, it, expect, beforeEach } from 'vitest';
import { AgentRuntimeImpl, type Agent, type AgentFactory } from '../agent-runtime/agent-runtime.js';
import type { AgentConfig } from '../contracts/agent.js';

function makeConfig(id: string, tenantId = 'tenant-1'): AgentConfig {
  return {
    id,
    tenantId,
    name: `agent-${id}`,
    systemPrompt: 'test',
    model: { provider: 'openai', model: 'gpt-4o' },
    temperature: 0.7,
    maxTokens: 4096,
    maxSteps: 10,
  };
}

describe('AgentRuntimeImpl', () => {
  let factoryCallCount = 0;
  let runtime: AgentRuntimeImpl;

  const factory: AgentFactory = async (config) => {
    factoryCallCount++;
    return {
      config,
      loop: {} as any, // mock loop
    };
  };

  beforeEach(() => {
    factoryCallCount = 0;
    runtime = new AgentRuntimeImpl(factory, 10);
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

  it('lists agents by tenant', async () => {
    await runtime.createAgent(makeConfig('agent-1', 'tenant-A'));
    await runtime.createAgent(makeConfig('agent-2', 'tenant-A'));
    await runtime.createAgent(makeConfig('agent-3', 'tenant-B'));

    const tenantAAgents = runtime.listAgents('tenant-A');
    expect(tenantAAgents).toHaveLength(2);
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
    const smallRuntime = new AgentRuntimeImpl(factory, 3);
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
