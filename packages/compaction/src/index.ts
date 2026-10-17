// @vico/compaction - 上下文压缩

export {
  ModelContextCompactor,
  ManualCompactionError,
  TargetPressureConfigError,
  isContextOverflowError,
} from './context-compactor.js';
export type {
  ContextCompactor,
  CompactionTrigger,
  CompactionResult,
  ManualCompactionErrorCode,
  ModelContextCompactorOptions,
} from './context-compactor.js';
export {
  COMPACTION_INSTRUCTION,
  CHECKPOINT_PREAMBLE,
  SUMMARY_OPEN_TAG,
  SUMMARY_CLOSE_TAG,
} from './context-compactor.js';
export {
  resolveSettings,
  resolveCompactSpec,
  selectCompactableRange,
  DEFAULT_COMPACTION_SETTINGS,
  type CompactionSettings,
  type ResolvedCompactionSettings,
  type ResolvedCompactSpec,
  type CompactionModelPolicy,
  type TurnTokenBudget,
  type CompactableRange,
} from './compaction-config.js';
export {
  estimateContent,
  estimateMessage,
  measure,
  CHARS_PER_TOKEN,
  BLOCK_OVERHEAD,
  ROLE_OVERHEAD,
  type TokenAnchor,
  type PricedMessage,
  type TokenMeasurement,
} from './token-estimator.js';
