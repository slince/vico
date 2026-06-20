// event-recorder.test.ts — tests for MittEventRecorder: emit, on, off, wildcard
import { describe, it, expect, vi } from 'vitest';
import { MittEventRecorder } from '../observable/event-recorder.js';
import type { SSEEvent } from '../contracts/events.js';

describe('MittEventRecorder', () => {
  it('emits and receives events', () => {
    const recorder = new MittEventRecorder();
    const handler = vi.fn();

    recorder.on('text_delta', handler);
    recorder.emit({ type: 'text_delta', content: 'hello' });

    expect(handler).toHaveBeenCalledOnce();
    expect(handler.mock.calls[0][0]).toMatchObject({ type: 'text_delta', content: 'hello' });
  });

  it('supports wildcard listener', () => {
    const recorder = new MittEventRecorder();
    const handler = vi.fn();

    recorder.on('*', handler);
    recorder.emit({ type: 'text_delta', content: 'a' });
    recorder.emit({ type: 'done' });

    expect(handler).toHaveBeenCalledTimes(2); // mitt wildcard catches both event types
  });

  it('removes listener via off()', () => {
    const recorder = new MittEventRecorder();
    const handler = vi.fn();

    recorder.on('text_delta', handler);
    recorder.off('text_delta', handler);
    recorder.emit({ type: 'text_delta', content: 'hello' });

    expect(handler).not.toHaveBeenCalled();
  });
});
