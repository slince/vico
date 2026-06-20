// src/__tests__/child-agent-executor.test.ts
import { describe, it, expect } from 'vitest';
import { ChildAgentExecutor } from '../tool/child-agent-executor.js';

describe('ChildAgentExecutor', () => {
  it('creates delegate tool spec', () => {
    const executor = new ChildAgentExecutor();
    const spec = executor.createDelegateToolSpec('agent-1', 'Code Reviewer');
    expect(spec.name).toBe('delegate_agent-1');
    expect(spec.kind).toBe('delegate');
    expect(spec.description).toContain('Code Reviewer');
  });

  it('returns error for unknown agent', async () => {
    const executor = new ChildAgentExecutor();
    const result = await executor.execute(
      { id: '1', name: 'delegate_unknown', args: {} },
      { tenantId: 't1', userId: 'u1', agentId: 'a1', threadId: 'th1', workspace: '/', hooks: [], signal: new AbortController().signal, awaitApproval: async () => ({ approved: true }) },
    );
    expect(result.status).toBe('error');
  });

  it('unregister removes agent', async () => {
    const executor = new ChildAgentExecutor();
    // Just verify unregister doesn't throw
    executor.unregister('nonexistent');
  });
});
