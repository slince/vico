// src/__tests__/approval-gate.test.ts
import { describe, it, expect, vi } from 'vitest';
import { ApprovalGate } from '../agent-loop/approval-gate.js';
import { MittEventRecorder } from '../events/event-recorder.js';

describe('ApprovalGate', () => {
  it('calls handler and returns decision', async () => {
    const events = new MittEventRecorder();
    const handler = vi.fn().mockResolvedValue({ approved: true });
    const gate = new ApprovalGate(handler, events);

    const decision = await gate.requestApproval({ id: '1', name: 'test', args: {} });
    expect(decision.approved).toBe(true);
    expect(handler).toHaveBeenCalled();
  });

  it('emits approval_request event', async () => {
    const events = new MittEventRecorder();
    const caught: any[] = [];
    events.on('approval_request', (e) => caught.push(e));

    const gate = new ApprovalGate(async () => ({ approved: true }), events);
    await gate.requestApproval({ id: '2', name: 'delete', args: { file: 'x' } });

    expect(caught).toHaveLength(1);
    expect(caught[0].name).toBe('delete');
  });

  it('times out after specified duration', async () => {
    const events = new MittEventRecorder();
    const gate = new ApprovalGate(
      async () => new Promise(() => {}), // never resolves
      events,
      50, // short timeout
    );
    const decision = await gate.requestApproval({ id: '3', name: 'slow', args: {} });
    expect(decision.approved).toBe(false);
    expect(decision.reason).toContain('timeout');
  });

  it('handles handler errors gracefully', async () => {
    const events = new MittEventRecorder();
    const gate = new ApprovalGate(
      async () => { throw new Error('boom'); },
      events,
      1000,
    );
    const decision = await gate.requestApproval({ id: '4', name: 'faulty', args: {} });
    expect(decision.approved).toBe(false);
    expect(decision.reason).toContain('error');
  });
});
