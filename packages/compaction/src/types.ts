// @vico/compaction — 上下文压缩的类型与端口定义
import type {Thread, ThreadStore} from '@vico/thread';
import type {ModelClient, ModelConfig} from '@vico/model';
import type {ModelMessage} from 'ai';
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

/**
 * 压缩所需的最小 turn 上下文。LoopAgent 的 TurnContext 结构上满足该接口，
 * 从而避免 @vico/compaction 反向依赖 @vico/agent 造成循环依赖。
 */
export interface CompactionContext {
  /** 本轮内存消息链（前 historyCount 条为注入的历史前缀，压缩只作用于这部分） */
  messages: ModelMessage[];
  /** 注入的历史消息条数 */
  historyCount: number;
  session: { thread: Thread };
  modelClient: ModelClient;
  signal: AbortSignal;
}

/** 上下文压缩端口（对齐 deepseek CompactionEngine） */
export interface ContextCompactor {
  compactIfNeeded(context: CompactionContext, trigger: CompactionTrigger): Promise<CompactionResult | null>;
  compactNow(thread: Thread, modelClient: ModelClient, signal: AbortSignal): Promise<CompactionResult | null>;
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
