/**
 * Span 类型。
 */
export type SpanType =
  | 'agent_run'
  | 'model_step'
  | 'tool_call'
  | 'memory_retrieval'
  | 'rag_search'
  | 'skill_activation'
  | 'context_compaction';

/**
 * Span — 追踪单次操作。
 */
export interface Span {
  readonly id: string;
  end(result?: Record<string, unknown>): void;
  error(error: Error): void;
}

/**
 * SpanTracker — 可观测性追踪器端口。
 */
export interface SpanTracker {
  startSpan(type: SpanType, metadata?: Record<string, unknown>): Span;
}

/**
 * 标准 SSE 事件类型。
 */
export type SSEEvent =
  | { type: 'text_delta'; content: string }
  | { type: 'reasoning_delta'; content: string }
  | { type: 'tool_call'; callId: string; name: string; arguments: Record<string, unknown> }
  | { type: 'tool_result'; callId: string; output: string; isError?: boolean }
  | { type: 'step_start'; step: number }
  | { type: 'step_finish'; step: number }
  | { type: 'done'; finishReason: string; usage: { input: number; output: number } }
  | { type: 'error'; message: string; code?: string };

/**
 * EventRecorder — SSE 事件广播端口。
 */
export interface EventRecorder {
  emit(event: SSEEvent): void;
  on(type: string, handler: (data: unknown) => void): () => void;
}
