// event-recorder.test.ts — tests for MittEventRecorder: emit, on, off, wildcard
import { describe, it, expect, vi } from 'vitest';
import { MittEventRecorder } from '../src/events/event-recorder.js';
import type { TurnEvent } from '../src/agent-loop/types.js';

describe('MittEventRecorder', () => {
  it('emits and receives events', () => {
    const recorder = new MittEventRecorder<TurnEvent>();
    const handler = vi.fn();

    recorder.on('text-delta', handler);
    recorder.emit({ type: 'text-delta', content: 'hello' });

    expect(handler).toHaveBeenCalledOnce();
    expect(handler.mock.calls[0][0]).toMatchObject({ type: 'text-delta', content: 'hello' });
  });

  it('supports wildcard listener', () => {
    const recorder = new MittEventRecorder<TurnEvent>();
    const handler = vi.fn();

    recorder.on('*', handler);
    recorder.emit({ type: 'text-delta', content: 'a' });
    recorder.emit({ type: 'done', usage: { input: 0, output: 0 } });

    expect(handler).toHaveBeenCalledTimes(2); // mitt wildcard catches both event types
  });

  it('removes listener via off()', () => {
    const recorder = new MittEventRecorder<TurnEvent>();
    const handler = vi.fn();

    recorder.on('text-delta', handler);
    recorder.off('text-delta', handler);
    recorder.emit({ type: 'text-delta', content: 'hello' });

    expect(handler).not.toHaveBeenCalled();
  });
});
