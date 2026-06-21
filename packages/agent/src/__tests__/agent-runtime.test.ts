// agent-runtime.test.ts — tests for AgentRuntime: register, destroy, LRU eviction
import { describe, it, expect, beforeEach } from 'vitest';
import { AgentRuntime } from '../agent-loop/agent-runtime.js';
import { Agent } from '../agent-loop/types.js';
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

function makeAgent(id: string): Agent {
  return new Agent({ config: makeConfig(id) });
}

describe('AgentRuntime', () => {
  let runtime: AgentRuntime;

  beforeEach(() => {
    runtime = new AgentRuntime(10);
  });

  it('registers and retrieves agent', () => {
    const agent = makeAgent('agent-1');
    runtime.register(agent);
    expect(runtime.getAgent('agent-1')?.config.name).toBe('agent-agent-1');
  });

  it('re-register replaces existing agent', () => {
    const agent1 = makeAgent('agent-1');
    runtime.register(agent1);
    const agent2 = makeAgent('agent-1');
    agent2.config.name = 'updated-name';
    runtime.register(agent2);
    expect(runtime.getAgent('agent-1')?.config.name).toBe('updated-name');
  });

  it('lists all registered agents', () => {
    runtime.register(makeAgent('agent-1'));
    runtime.register(makeAgent('agent-2'));
    runtime.register(makeAgent('agent-3'));

    const agents = runtime.listAgents();
    expect(agents).toHaveLength(3);
  });

  it('destroys agent', () => {
    runtime.register(makeAgent('agent-1'));
    runtime.destroy('agent-1');
    expect(runtime.getAgent('agent-1')).toBeUndefined();
  });

  it('evicts LRU when over capacity', () => {
    const smallRuntime = new AgentRuntime(3);
    smallRuntime.register(makeAgent('agent-1'));
    smallRuntime.register(makeAgent('agent-2'));
    smallRuntime.register(makeAgent('agent-3'));

    // touch agent-2, agent-3 so agent-1 becomes oldest
    smallRuntime.getAgent('agent-2');
    smallRuntime.getAgent('agent-3');

    smallRuntime.register(makeAgent('agent-4')); // triggers eviction

    // agent-1 should be evicted (oldest)
    expect(smallRuntime.getAgent('agent-1')).toBeUndefined();
    expect(smallRuntime.getAgent('agent-4')).toBeDefined();
  });

  it('getAgent updates lastUsedAt (LRU tracking)', () => {
    const smallRuntime = new AgentRuntime(2);
    smallRuntime.register(makeAgent('agent-1'));
    smallRuntime.register(makeAgent('agent-2'));

    // Touch agent-1 so agent-2 becomes the LRU target
    smallRuntime.getAgent('agent-1');
    smallRuntime.register(makeAgent('agent-3'));

    expect(smallRuntime.getAgent('agent-1')).toBeDefined();
    expect(smallRuntime.getAgent('agent-2')).toBeUndefined();
  });
});
