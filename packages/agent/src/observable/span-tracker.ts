// @vico/agent - SpanTracker port interface + InMemory implementation
import type { SpanType } from '../contracts/events.js';
import { randomUUID } from 'node:crypto';

/** 追踪 Span — 表示一个操作的时间段 */
export interface Span {
  /** Span 唯一标识 */
  readonly id: string;
  /** 正常结束 Span，可附带结果 */
  end(result?: Record<string, unknown>): void;
  /** 以错误结束 Span */
  error(error: Error): void;
}

/** Span 追踪器端口 — 创建和管理追踪 Span */
export interface SpanTracker {
  /** 启动一个追踪 Span */
  startSpan(type: SpanType, metadata?: Record<string, unknown>): Span;
}

/** Span 内部状态 */
interface SpanState {
  id: string;
  type: SpanType;
  metadata: Record<string, unknown>;
  startTime: number;
  endTime?: number;
  error?: string;
  result?: Record<string, unknown>;
}

/** 内存 Span 追踪器实现 */
export class InMemorySpanTracker implements SpanTracker {
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

  /** 获取所有已记录的 span（用于测试/导出） */
  getAllSpans(): ReadonlyArray<SpanState> {
    return this.spans;
  }

  /** 清空 */
  clear(): void {
    this.spans = [];
  }
}
