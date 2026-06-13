import { describe, it, expect } from 'vitest';

describe('runTeamPipeline', () => {
  it('module can be imported', async () => {
    const mod = await import('../orchestrator.js');
    expect(typeof mod.runTeamPipeline).toBe('function');
  });
});
