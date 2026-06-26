// src/__tests__/approval-gate.test.ts
import { describe, it, expect } from 'vitest';
import { ApprovalGate } from '../agent-loop/approval-gate.js';
import { MittEventRecorder } from '../events/event-recorder.js';

describe('ApprovalGate', () => {
  it('resolves via decide()', async () => {
    const events = new MittEventRecorder();
    const gate = new ApprovalGate(events);

    const { approvalId, decision } = gate.requestApproval({ id: '1', name: 'test', args: {} });
    const resolved = gate.decide(approvalId, { approved: true });
    expect(resolved).toBe(true);

    const result = await decision;
    expect(result.approved).toBe(true);
  });

  it('emits approval_request event', () => {
    const events = new MittEventRecorder();
    const caught: any[] = [];
    events.on('approval_request', (e) => caught.push(e));

    const gate = new ApprovalGate(events);
    gate.requestApproval({ id: '2', name: 'delete', args: { file: 'x' } });

    expect(caught).toHaveLength(1);
    expect(caught[0].name).toBe('delete');
    expect(caught[0].approvalId).toBeDefined();
  });

  it('times out after specified duration', async () => {
    const events = new MittEventRecorder();
    const gate = new ApprovalGate(events, 50);

    const { decision } = gate.requestApproval({ id: '3', name: 'slow', args: {} });
    await expect(decision).resolves.toMatchObject({
      approved: false,
      reason: 'Approval timeout',
    });
  });

  it('cancelAll rejects all pending', async () => {
    const events = new MittEventRecorder();
    const gate = new ApprovalGate(events);

    const { decision: d1 } = gate.requestApproval({ id: '4a', name: 'a', args: {} });
    const { decision: d2 } = gate.requestApproval({ id: '4b', name: 'b', args: {} });

    gate.cancelAll('aborted');

    await expect(d1).resolves.toMatchObject({ approved: false, reason: 'aborted' });
    await expect(d2).resolves.toMatchObject({ approved: false, reason: 'aborted' });
    expect(gate.pendingCount).toBe(0);
  });

  it('decide returns false for unknown approvalId', () => {
    const events = new MittEventRecorder();
    const gate = new ApprovalGate(events);

    expect(gate.decide('nonexistent', { approved: true })).toBe(false);
  });

  it('uses custom approvalId', async () => {
    const events = new MittEventRecorder();
    const gate = new ApprovalGate(events);

    const { approvalId, decision } = gate.requestApproval(
      { id: '5', name: 'tool', args: {} },
      undefined,
      'my-custom-id',
    );
    expect(approvalId).toBe('my-custom-id');

    gate.decide('my-custom-id', { approved: false, reason: 'nope' });
    const result = await decision;
    expect(result.approved).toBe(false);
  });

  it('decide after timeout returns false', async () => {
    const events = new MittEventRecorder();
    const gate = new ApprovalGate(events, 10);

    const { approvalId, decision } = gate.requestApproval({ id: '6', name: 'fast', args: {} });
    // wait for timeout
    await decision;
    expect(gate.decide(approvalId, { approved: true })).toBe(false);
    expect(gate.pendingCount).toBe(0);
  });
});
