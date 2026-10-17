// @vico/compaction - 上下文压缩

export {ModelContextCompactor} from './model-context-compactor.js';
export {
  ManualCompactionError,
  TargetPressureConfigError,
  isContextOverflowError,
} from './errors.js';
export type {
  ContextCompactor,
  CompactionTrigger,
  CompactionResult,
  ManualCompactionErrorCode,
  ModelContextCompactorOptions,
} from './types.js';
export type {CompactionSettings} from './compaction-config.js';
