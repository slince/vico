// hook-runner.test.ts — tests for HookRunner and CompositeHookRunner
import { describe, it, expect } from 'vitest';
import { HookRunner, CompositeHookRunner } from '../hook/hook-runner.js';

describe('HookRunner', () => {
  it('runs handler and returns result', async () => {
    const runner = new HookRunner('turn:start', async (data) => ({
      action: 'continue',
      message: `got: ${data}`,
    }));
    const result = await runner.run('test-data');
    expect(result.action).toBe('continue');
    expect(result.message).toBe('got: test-data');
  });

  it('catches handler errors gracefully', async () => {
    const runner = new HookRunner('tool:before', async () => {
      throw new Error('boom');
    });
    const result = await runner.run({});
    expect(result.action).toBe('continue');
    expect(result.message).toContain('boom');
  });
});

describe('CompositeHookRunner', () => {
  it('runs matching hooks in order', async () => {
    const composite = new CompositeHookRunner();
    const order: number[] = [];

    composite.register(
      new HookRunner('turn:start', async () => {
        order.push(1);
        return { action: 'continue' };
      }),
    );
    composite.register(
      new HookRunner('turn:start', async () => {
        order.push(2);
        return { action: 'continue' };
      }),
    );

    await composite.runAll('turn:start', {});
    expect(order).toEqual([1, 2]);
  });

  it('stops on deny', async () => {
    const composite = new CompositeHookRunner();
    const order: number[] = [];

    composite.register(
      new HookRunner('tool:before', async () => {
        order.push(1);
        return { action: 'deny', message: 'blocked' };
      }),
    );
    composite.register(
      new HookRunner('tool:before', async () => {
        order.push(2);
        return { action: 'continue' };
      }),
    );

    const result = await composite.runAll('tool:before', {});
    expect(result.action).toBe('deny');
    expect(order).toEqual([1]); // second hook never runs
  });

  it('passes modified data through', async () => {
    const composite = new CompositeHookRunner();

    composite.register(
      new HookRunner('prompt:submit', async (data) => ({
        action: 'modify',
        modifiedData: { ...(data as any), extra: true },
      })),
    );

    const result = await composite.runAll('prompt:submit', { original: 1 });
    expect(result.action).toBe('continue');
    expect((result.modifiedData as any).original).toBe(1);
    expect((result.modifiedData as any).extra).toBe(true);
  });
});
