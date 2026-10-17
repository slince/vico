// @vico/compaction — 上下文压缩的类型与端口定义
import type {Thread, ThreadStore} from '@vico/thread';
import type {ModelClient, ModelConfig} from '@vico/model';
import type {CompactionSettings} from './compaction-config.js';

/** 压缩触发类型：pressure（窗口压力）/ context-overflow（模型报错超限） */
export type CompactionTrigger = 'pressure' | 'context-overflow';

/** 手动压缩失败分类（仅列出实际会抛出的 code） */
export type ManualCompactionErrorCode = 'busy' | 'summary';

/** 压缩结果 */
export interface CompactionResult {
  summaryMessageId: string;
  archivedTurnIds: string[];
  removedTokens: number;
}

/** 上下文压缩端口（对齐 deepseek CompactionEngine） */
export interface ContextCompactor {
  compactIfNeeded(thread: Thread, modelClient: ModelClient, trigger: CompactionTrigger, signal: AbortSignal): Promise<CompactionResult | null>;
  compactNow(thread: Thread, modelClient: ModelClient, signal: AbortSignal): Promise<CompactionResult | null>;
  /** pressureTokens 为 undefined 时表示本轮无 usage 上报，应清除锚点而非写入 0 */
  recordUsage(threadId: string, pressureTokens: number | undefined): void;
  /** 任一 turn 收到正常 assistant 消息时调用，清零 context-overflow 重试计数 */
  noteModelSuccess(thread: Thread): void;
}

/** ModelContextCompactor 构造选项 */
export interface ModelContextCompactorOptions {
  thread: ThreadStore;
  /** 候选 surface 的最近已完成 turn 数（对齐 stm_window） */
  conversationWindow: number;
  /** agent 原始模型配置（contextWindow + 独立摘要模型解析） */
  modelConfig?: ModelConfig;
  /** agent 输出上限（reservedCompletionTokens） */
  maxTokens?: number;
  settings?: Partial<CompactionSettings>;
}
