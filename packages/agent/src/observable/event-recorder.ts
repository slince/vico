// @vico/agent - EventRecorder port interface + Mitt-based implementation
import mitt, { type Emitter } from 'mitt';
import type { EventRecorder } from './types.js';
import type { SSEEvent } from './types.js';

export type { EventRecorder } from './types.js';

/** 基于 mitt 的 EventRecorder 实现 */
export class MittEventRecorder implements EventRecorder {
  private emitter: Emitter<Record<string, unknown>>;

  constructor() {
    const createEmitter = mitt as unknown as <T extends Record<string, unknown>>() => Emitter<T>;
    this.emitter = createEmitter<Record<string, unknown>>();
  }

  emit(event: SSEEvent): void {
    this.emitter.emit(event.type, event);
  }

  on(event: string, handler: (data: unknown) => void): void {
    this.emitter.on(event, handler);
  }

  off(event: string, handler: (data: unknown) => void): void {
    this.emitter.off(event, handler);
  }
}
