// @vico/agent - 可观测性模块类型定义（Span 追踪）
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

/** 追踪 Span — 表示一个操作的时间段 */
export interface Span {
  /** Span 唯一标识 */
  readonly id: string;
  /** 正常结束 Span，可附带结果 */
  end(result?: Record<string, unknown>): void;
  /** 以错误结束 Span */
  error(error: Error): void;
}

/** Span 内部状态（导出给 LoopTracer 使用） */
export interface SpanState {
  id: string;
  type: SpanType;
  metadata: Record<string, unknown>;
  startTime: number;
  endTime?: number;
  error?: string;
  result?: Record<string, unknown>;
}

/** Span 追踪器端口 — 创建和管理追踪 Span */
export interface SpanTracker {
  /** 启动一个追踪 Span */
  startSpan(type: SpanType, metadata?: Record<string, unknown>): Span;
  /** 获取所有已记录的 span（用于导出/追踪） */
  getAllSpans(): ReadonlyArray<SpanState>;
  /** 清空已记录的 span */
  clear(): void;
}
