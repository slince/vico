// @vico/agent - EventRecorder port interface + Mitt-based implementation
import mitt, { type Emitter } from 'mitt';
import type { SSEEvent } from '../contracts/events.js';

/** SSE 事件广播器端口 */
export interface EventRecorder {
  /** 发射 SSE 事件 */
  emit(event: SSEEvent): void;
  /** 注册事件监听器 */
  on(event: string, handler: (data: unknown) => void): void;
  /** 移除事件监听器 */
  off(event: string, handler: (data: unknown) => void): void;
}

/** 基于 mitt 的 EventRecorder 实现 */
export class MittEventRecorder implements EventRecorder {
  private emitter: Emitter<Record<string, unknown>>;

  constructor() {
    this.emitter = mitt<Record<string, unknown>>();
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
