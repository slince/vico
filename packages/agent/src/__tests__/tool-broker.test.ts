// src/__tests__/tool-broker.test.ts
import { describe, it, expect } from 'vitest';
import {z} from 'zod';
import { ToolBroker } from '../tool/tool-broker.js';
import {createTool} from '../tool/create-tool.js';
import {coreBuiltinTools} from '../tool/builtin/index.js';

function makeCtx(overrides?: Record<string, unknown>): any {
  return {
    userId: 'u1', agentId: 'a1', threadId: 'th1',
    workspace: '/tmp',
    awaitApproval: async () => ({ approved: true }),
    signal: new AbortController().signal,
    ...overrides,
  };
}

function makeHost(): ToolBroker {
  return new ToolBroker(coreBuiltinTools);
}

describe('ToolBroker', () => {
  it('lists builtin tools', () => {
    const host = makeHost();
    const tools = host.list();
    expect(tools.some((t) => t.name === 'echo')).toBe(true);
    expect(tools.some((t) => t.name === 'now')).toBe(true);
  });

  it('executes echo tool', async () => {
    const host = makeHost();
    const result = await host.execute({ id: '1', name: 'echo', args: { message: 'hello' } }, makeCtx());
    expect(result.status).toBe('success');
    expect(result.output).toEqual({ message: 'hello' });
  });

  it('executes now tool', async () => {
    const host = makeHost();
    const result = await host.execute({ id: '2', name: 'now', args: {} }, makeCtx());
    expect(result.status).toBe('success');
    expect(result.output).toHaveProperty('datetime');
    expect(typeof (result.output as any).datetime).toBe('string');
  });

  it('returns error for unknown tool', async () => {
    const host = makeHost();
    const result = await host.execute({ id: '3', name: 'nonexistent', args: {} }, makeCtx());
    expect(result.status).toBe('error');
  });

  it('executes batch with readonly parallel', async () => {
    const host = makeHost();
    const results = await host.executeBatch([
      { id: '1', name: 'echo', args: { message: 'a' } },
      { id: '2', name: 'echo', args: { message: 'b' } },
    ], makeCtx());
    expect(results).toHaveLength(2);
    expect(results.every((r) => r.status === 'success')).toBe(true);
  });

  it('blocks never-policy tool', async () => {
    const host = new ToolBroker([createTool({
      name: 'dangerous', description: '', inputSchema: z.object({}),
      policy: 'never', kind: 'command', tags: ['test'],
      execute: async () => 'should not run',
    })]);
    const result = await host.execute({ id: 'x', name: 'dangerous', args: {} }, makeCtx());
    expect(result.status).toBe('error');
    expect(result.error).toContain('blocked by policy');
  });
});
