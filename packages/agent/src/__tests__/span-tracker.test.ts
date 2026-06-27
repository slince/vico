// span-tracker.test.ts — tests for InMemorySpanSession: start, end, error
import { describe, it, expect } from 'vitest';
import { InMemorySpanTracker } from '../observable/span-tracker.js';

describe('InMemorySpanTracker', () => {
  it('starts and ends a span', () => {
    const tracker = new InMemorySpanTracker();
    const session = tracker.startSession();
    const span = session.startSpan('agent_run', { threadId: 't1' });

    expect(span.id).toBeDefined();
    span.end({ status: 'ok' });

    const spans = session.getAllSpans();
    expect(spans).toHaveLength(1);
    expect(spans[0].type).toBe('agent_run');
    expect(spans[0].result).toEqual({ status: 'ok' });
  });

  it('records error on span', () => {
    const tracker = new InMemorySpanTracker();
    const session = tracker.startSession();
    const span = session.startSpan('tool_call');
    span.error(new Error('timeout'));

    const spans = session.getAllSpans();
    expect(spans[0].error).toBe('timeout');
  });

  it('each session has isolated spans', () => {
    const tracker = new InMemorySpanTracker();
    const session1 = tracker.startSession();
    session1.startSpan('model_step').end();

    const session2 = tracker.startSession();
    session2.startSpan('agent_run').end();

    // 每个 session 独立，互不影响
    expect(session1.getAllSpans()).toHaveLength(1);
    expect(session1.getAllSpans()[0].type).toBe('model_step');
    expect(session2.getAllSpans()).toHaveLength(1);
    expect(session2.getAllSpans()[0].type).toBe('agent_run');
  });
});
