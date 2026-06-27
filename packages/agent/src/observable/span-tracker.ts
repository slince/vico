// @vico/agent - SpanTracker port interface + InMemory implementation
import type { Span, SpanSession, SpanState, SpanTracker } from './types.js';
import type { SpanType } from './types.js';
import { randomUUID } from 'node:crypto';

/** 单次 turn 的内存 Span 收集器 — 隔离的 span 集合，并发安全 */
export class InMemorySpanSession implements SpanSession {
  private spans: SpanState[] = [];

  startSpan(type: SpanType, metadata?: Record<string, unknown>): Span {
    const id = randomUUID();
    const state: SpanState = {
      id,
      type,
      metadata: metadata ?? {},
      startTime: Date.now(),
    };
    this.spans.push(state);

    return {
      id,
      end: (result?: Record<string, unknown>) => {
        state.endTime = Date.now();
        state.result = result;
      },
      error: (err: Error) => {
        state.endTime = Date.now();
        state.error = err.message;
      },
    };
  }

  getAllSpans(): ReadonlyArray<SpanState> {
    return this.spans;
  }
}

/** SpanTracker 工厂 — 每个 turn 创建独立的 InMemorySpanSession */
export class InMemorySpanTracker implements SpanTracker {
  startSession(): SpanSession {
    return new InMemorySpanSession();
  }
}
