// @vico/agent - Observable module type definitions
import { z } from 'zod';

export const SpanTypeSchema = z.enum([
  'agent_run',
  'model_step',
  'tool_call',
  'memory_retrieval',
  'rag_search',
  'skill_activation',
  'context_compaction',
]);
export type SpanType = z.infer<typeof SpanTypeSchema>;

/** 事件基础约束：每个事件必须包含 type 判别字段 */
export interface TypedEvent {
  type: string;
}

/** 从联合事件类型中按 type 字段提取对应的完整 payload（含 type）。无匹配时回退到完整 TEvent */
export type EventPayload<TEvent extends TypedEvent, K extends string> =
  [Extract<TEvent, { type: K }>] extends [never] ? TEvent : Extract<TEvent, { type: K }>;

/** SSE 事件广播器端口。TEvent 为事件联合类型，默认兜底兼容旧代码 */
export interface EventRecorder<TEvent extends TypedEvent = TypedEvent> {
  /** 发射 SSE 事件 */
  emit(event: TEvent): void;
  /** 注册事件监听器。K 为事件 type 字符串或 '*' 通配符 */
  on<K extends string>(event: K, handler: (data: EventPayload<TEvent, K>) => void): void;
  /** 移除事件监听器 */
  off<K extends string>(event: K, handler: (data: EventPayload<TEvent, K>) => void): void;
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
