// src/__tests__/child-agent-executor.test.ts
import { describe, it, expect } from 'vitest';
import { ChildAgentExecutor } from '../tool/child-agent-executor.js';

describe('ChildAgentExecutor', () => {
  it('creates delegate tool', () => {
    const executor = new ChildAgentExecutor();
    const tool = executor.createDelegateTool('agent-1', 'Code Reviewer');
    expect(tool.name).toBe('delegate_agent-1');
    expect(tool.kind).toBe('delegate');
    expect(tool.description).toContain('Code Reviewer');
  });

  it('returns error for unknown agent', async () => {
    const executor = new ChildAgentExecutor();
    const result = await executor.executeDelegate(
      { id: '1', name: 'delegate_unknown', args: {} },
      { session: { userId: 'u1', threadId: 'th1', workspace: '/' }, agentId: 'a1', signal: new AbortController().signal, awaitApproval: async () => ({ approved: true }) },
    );
    expect(result.status).toBe('error');
  });

  it('unregister removes agent', async () => {
    const executor = new ChildAgentExecutor();
    // Just verify unregister doesn't throw
    executor.unregister('nonexistent');
  });
});
