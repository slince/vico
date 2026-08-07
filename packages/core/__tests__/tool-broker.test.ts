// src/__tests__/tool-broker.test.ts
import {describe, expect, it, vi} from 'vitest';
import {z} from 'zod';
import {ToolExecutor, type ToolExecutorHost} from '../src/agent/tool-executor.js';
import {createTool} from '../src/tool/create-tool.js';
import {coreBuiltinTools} from '../src/tool/builtin/index.js';
import {MemoryCheckpointStore} from '../src/agent/memory-checkpoint-store.js';

function makeCtx(overrides?: Record<string, unknown>): any {
  return {
    userId: 'u1', agentId: 'a1', threadId: 'th1',
    workspace: '/tmp',
    signal: new AbortController().signal,
    ...overrides,
  };
}

function makeHost(tools = coreBuiltinTools): ToolExecutor {
  const host: ToolExecutorHost = {
    checkpointStore: new MemoryCheckpointStore(),
    emit: vi.fn(),
    persistMessage: vi.fn(),
    resolveToolResult: vi.fn((r) => typeof r.output === 'string' ? r.output : JSON.stringify(r.output)),
    appendToolResults: vi.fn(),
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as any,
  };
  return new ToolExecutor({ tools, host });
}

describe('ToolExecutor', () => {
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
  

  it('blocks never-policy tool', async () => {
    const host = makeHost([createTool({
      name: 'dangerous', description: '', inputSchema: z.object({}),
      policy: 'never', kind: 'command', tags: ['test'],
      execute: async () => 'should not run',
    })]);
    const result = await host.execute({ id: 'x', name: 'dangerous', args: {} }, makeCtx());
    expect(result.status).toBe('error');
    expect(result.error).toContain('blocked by policy');
  });
});
