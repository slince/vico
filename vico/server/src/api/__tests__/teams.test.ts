import { describe, it, expect } from 'vitest';

describe('Teams CRUD', () => {
  it('module can be imported', async () => {
    // Verify the teams route module loads without errors
    const mod = await import('../teams.js');
    expect(typeof mod.teamRoutes).toBe('function');
  });
});
