// @vico/compaction — 压缩错误与上下文超限检测
import type {ManualCompactionErrorCode} from './types.js';

export class ManualCompactionError extends Error {
  constructor(readonly code: ManualCompactionErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ManualCompactionError';
  }
}

/** pressure 触发但未配置 contextWindow 时抛出（对齐 deepseek TargetPressureConfigError） */
export class TargetPressureConfigError extends Error {
  constructor() {
    super('contextWindow is required for pressure-triggered compaction');
    this.name = 'TargetPressureConfigError';
  }
}

/** 上下文超限启发式检测（对齐 deepseek CONTEXT_WINDOW_EXCEEDED_CODE 的 Vico 侧适配） */
export function isContextOverflowError(error: unknown): boolean {
  const text = (typeof error === 'string' ? error : '') + ' '
    + ((error as { message?: string } | null)?.message ?? '') + ' '
    + String((error as { statusCode?: number } | null)?.statusCode ?? '');
  return /context.?length|context_length_exceeded|maximum context|too many tokens|token limit|context window/i.test(text);
}
