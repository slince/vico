// @vico/core - 可观测性模块类型定义（Span 追踪）

export type SpanType =
  | 'agent_run'
  | 'agent_resume'
  | 'model_step'
  | 'tool_call'
  | 'memory_retrieval'
  | 'rag_search'
  | 'skill_activation'
  | 'context_compaction';

/** 追踪 Span — 表示一个操作的时间段 */
export interface Span {
  /** Span 唯一标识 */
  readonly id: string;
  /** 正常结束 Span，可附带结果 */
  end(result?: Record<string, unknown>): void;
  /** 以错误结束 Span */
  error(error: Error|string): void;
}

/** Span 内部状态（导出给 trace 模块使用） */
export interface SpanState {
  id: string;
  type: SpanType;
  parentSpanId?: string;
  metadata: Record<string, unknown>;
  startTime: number;
  endTime?: number;
  error?: string;
  result?: Record<string, unknown>;
}
