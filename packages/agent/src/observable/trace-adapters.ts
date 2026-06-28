// @vico/agent - TraceAdapter interface + factory
import type { TurnTrace, TraceLevel } from './loop-tracer.js';
import { ConsoleTraceAdapter } from './console-trace-adapter.js';
import { FileTraceAdapter } from './file-trace-adapter.js';

// ── 适配器接口 ──

/** Trace 持久化适配器 — 负责将 trace 输出到目标 */
export interface TraceAdapter {
  write(trace: TurnTrace): void | Promise<void>;
}

// ── 重导出 ──

export { ConsoleTraceAdapter } from './console-trace-adapter.js';
export { FileTraceAdapter, DEFAULT_TRACE_DIR, type FileTraceAdapterOptions } from './file-trace-adapter.js';
export type { TraceOptions } from '../container/options.js';

// ── 工厂 ──

/**
 * 根据 TraceLevel 创建默认适配器列表。
 * @param level - 追踪级别，0=关闭，1=console，2=console+文件
 * @returns TraceAdapter 数组
 */
export function createAdaptersFromLevel(level: TraceLevel): TraceAdapter[] {
  const adapters: TraceAdapter[] = [];
  if (level >= 1) adapters.push(new ConsoleTraceAdapter());
  if (level >= 2) adapters.push(new FileTraceAdapter());
  return adapters;
}
