// span-tracker.test.ts — tests for InMemorySpanTracker: start, end, error, clear
import { describe, it, expect } from 'vitest';
import { InMemorySpanTracker } from '../observable/span-tracker.js';

describe('InMemorySpanTracker', () => {
  it('starts and ends a span', () => {
    const tracker = new InMemorySpanTracker();
    const span = tracker.startSpan('agent_run', { threadId: 't1' });

    expect(span.id).toBeDefined();
    span.end({ status: 'ok' });

    const spans = tracker.getAllSpans();
    expect(spans).toHaveLength(1);
    expect(spans[0].type).toBe('agent_run');
    expect(spans[0].result).toEqual({ status: 'ok' });
  });

  it('records error on span', () => {
    const tracker = new InMemorySpanTracker();
    const span = tracker.startSpan('tool_call');
    span.error(new Error('timeout'));

    const spans = tracker.getAllSpans();
    expect(spans[0].error).toBe('timeout');
  });

  it('clear removes all spans', () => {
    const tracker = new InMemorySpanTracker();
    tracker.startSpan('model_step').end();
    tracker.clear();
    expect(tracker.getAllSpans()).toHaveLength(0);
  });
});
