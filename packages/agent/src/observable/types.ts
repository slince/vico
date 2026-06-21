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

export const SSEEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text_delta'), content: z.string() }),
  z.object({ type: z.literal('reasoning_delta'), content: z.string() }),
  z.object({ type: z.literal('tool_call_start'), id: z.string(), name: z.string() }),
  z.object({ type: z.literal('tool_call_delta'), id: z.string(), args: z.string() }),
  z.object({ type: z.literal('tool_result'), id: z.string(), name: z.string(), status: z.enum(['success', 'error']), output: z.unknown() }),
  z.object({ type: z.literal('step_start'), step: z.number() }),
  z.object({ type: z.literal('step_end'), step: z.number() }),
  z.object({ type: z.literal('compacted'), removedTokens: z.number() }),
  z.object({ type: z.literal('approval_request'), callId: z.string(), name: z.string(), args: z.record(z.string(), z.unknown()) }),
  z.object({ type: z.literal('done'), usage: z.object({ input: z.number(), output: z.number() }).optional() }),
  z.object({ type: z.literal('error'), message: z.string() }),
]);
export type SSEEvent = z.infer<typeof SSEEventSchema>;

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
