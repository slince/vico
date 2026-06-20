// @vico/agent - Observable module type definitions
import type { SSEEvent, SpanType } from '../contracts/events.js';

/** SSE 事件广播器端口 */
export interface EventRecorder {
  /** 发射 SSE 事件 */
  emit(event: SSEEvent): void;
  /** 注册事件监听器 */
  on(event: string, handler: (data: unknown) => void): void;
  /** 移除事件监听器 */
  off(event: string, handler: (data: unknown) => void): void;
}

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
