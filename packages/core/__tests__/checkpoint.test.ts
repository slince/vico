// checkpoint.test.ts — CheckpointStore unit tests
import { describe, expect, it } from 'vitest';
import { InMemoryCheckpointStore } from '../src/agent-loop/checkpoint-store.js';

describe('InMemoryCheckpointStore', () => {
  it('saves and retrieves a checkpoint', async () => {
    const store = new InMemoryCheckpointStore();
    const ckpt = await store.save('turn-1', 'thread-1', {
      stepIndex: 3,
      toolApprovalState: { 'read_file': true },
    });

    expect(ckpt.turnId).toBe('turn-1');
    expect(ckpt.stepIndex).toBe(3);
    expect(ckpt.toolApprovalState).toEqual({ 'read_file': true });
  });

  it('upserts on same turnId', async () => {
    const store = new InMemoryCheckpointStore();
    await store.save('turn-1', 'thread-1', { stepIndex: 1 });
    const ckpt = await store.save('turn-1', 'thread-1', { stepIndex: 5 });

    expect(ckpt.stepIndex).toBe(5);
    // Verify single row: listByThread returns only one
    const list = await store.listByThread('thread-1');
    expect(list).toHaveLength(1);
  });

  it('deletes checkpoint by turn', async () => {
    const store = new InMemoryCheckpointStore();
    await store.save('turn-1', 'thread-1', { stepIndex: 1 });
    await store.deleteByTurn('turn-1');
    expect(await store.getByTurn('turn-1')).toBeUndefined();
  });

  it('purges expired checkpoints', async () => {
    const store = new InMemoryCheckpointStore();
    // Create an "expired" checkpoint (directly manipulate internal store to set old timestamp)
    const ckpt = await store.save('turn-1', 'thread-1', { pauseInfo: { reason: 'tool-approval', pendingToolCalls: [], pausedAtStep: 0 } });
    // Use very short TTL (1ms) to trigger expiry
    await new Promise(r => setTimeout(r, 5));
    const expired = await store.purgeExpired(1);
    expect(expired).toContain('turn-1');
    expect(await store.getByTurn('turn-1')).toBeUndefined();
  });

  it('preserves completedToolCallIds across updates', async () => {
    const store = new InMemoryCheckpointStore();
    await store.save('turn-1', 'thread-1', {
      completedToolCallIds: ['call-1'],
      completedToolResults: [{ callId: 'call-1', name: 't1', status: 'success', output: 'ok' }],
    });
    await store.save('turn-1', 'thread-1', {
      completedToolCallIds: ['call-1', 'call-2'],
      completedToolResults: [
        { callId: 'call-1', name: 't1', status: 'success', output: 'ok' },
        { callId: 'call-2', name: 't2', status: 'success', output: 'ok2' },
      ],
    });
    const ckpt = await store.getByTurn('turn-1');
    expect(ckpt!.completedToolCallIds).toEqual(['call-1', 'call-2']);
    expect(ckpt!.completedToolResults).toHaveLength(2);
  });
});
