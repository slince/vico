// src/__tests__/tool-broker.test.ts
import { describe, it, expect } from 'vitest';
import { ToolBroker } from '../tool/tool-broker.js';

function makeCtx(overrides?: Record<string, unknown>): any {
  return {
    userId: 'u1', agentId: 'a1', threadId: 'th1',
    workspace: '/tmp', hooks: [],
    awaitApproval: async () => ({ approved: true }),
    signal: new AbortController().signal,
    ...overrides,
  };
}

describe('ToolBroker', () => {
  it('lists builtin tools', async () => {
    const host = new ToolBroker();
    const tools = await host.listTools(makeCtx());
    expect(tools.some((t) => t.name === 'echo')).toBe(true);
    expect(tools.some((t) => t.name === 'now')).toBe(true);
  });

  it('executes echo tool', async () => {
    const host = new ToolBroker();
    await host.listTools(makeCtx()); // initialize
    const result = await host.execute({ id: '1', name: 'echo', args: { message: 'hello' } }, makeCtx());
    expect(result.status).toBe('success');
    expect(result.output).toBe('hello');
  });

  it('executes now tool', async () => {
    const host = new ToolBroker();
    await host.listTools(makeCtx());
    const result = await host.execute({ id: '2', name: 'now', args: {} }, makeCtx());
    expect(result.status).toBe('success');
    expect(typeof result.output).toBe('string');
  });

  it('returns error for unknown tool', async () => {
    const host = new ToolBroker();
    await host.listTools(makeCtx());
    const result = await host.execute({ id: '3', name: 'nonexistent', args: {} }, makeCtx());
    expect(result.status).toBe('error');
  });

  it('executes batch with readonly parallel', async () => {
    const host = new ToolBroker();
    await host.listTools(makeCtx());
    const results = await host.executeBatch([
      { id: '1', name: 'echo', args: { message: 'a' } },
      { id: '2', name: 'echo', args: { message: 'b' } },
    ], makeCtx());
    expect(results).toHaveLength(2);
    expect(results.every((r) => r.status === 'success')).toBe(true);
  });

  it('blocks never-policy tool', async () => {
    const host = new ToolBroker();
    host.addSource({
      name: 'test',
      list: async () => [{
        name: 'dangerous', description: '', inputSchema: {},
        policy: 'never' as const, kind: 'command' as const, tags: ['test'],
        execute: async () => 'should not run',
      }],
    });
    await host.listTools(makeCtx());
    const result = await host.execute({ id: 'x', name: 'dangerous', args: {} }, makeCtx());
    expect(result.status).toBe('error');
    expect(result.error).toContain('blocked by policy');
  });
});
