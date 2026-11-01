// @vico/compaction — 上下文压缩的类型与端口定义
import type {AgentMessage, Thread, ThreadStore, Turn} from '@vico/thread';
import type {ModelClient, ModelConfig} from '@vico/model';
import type {CompactionSettings} from './compaction-config.js';

/** 压缩触发类型：pressure（窗口压力）/ context-overflow（模型报错超限） */
export type CompactionTrigger = 'pressure' | 'context-overflow';

/** 手动压缩失败分类（仅列出实际会抛出的 code） */
export type ManualCompactionErrorCode = 'busy' | 'summary' | 'no-final-turn';

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
  /** 本轮内存消息链（候选由完结态 turn 过滤决定，当前 turn 消息也可参与） */
  messages: AgentMessage[];
  session: { thread: Thread; turn: Turn };
  modelClient: ModelClient;
  signal: AbortSignal;
}

/** 上下文压缩端口（对齐 deepseek CompactionEngine） */
export interface ContextCompactor {
  compactIfNeeded(context: CompactionContext, trigger: CompactionTrigger): Promise<CompactionResult | null>;
  /**
   * 主动压缩（手动）：候选消息由调用方传入，summary 挂到线程最新完结态 turn。
   * 无完结态 turn 时抛 ManualCompactionError('no-final-turn')。
   */
  compactNow(thread: Thread, messages: AgentMessage[], modelClient: ModelClient, signal: AbortSignal): Promise<CompactionResult | null>;
}

/** ModelContextCompactor 构造选项 */
export interface ModelContextCompactorOptions {
  thread: ThreadStore;
  /** @deprecated 候选 surface 现由调用方传入的 messages 决定，此字段保留仅为接口兼容 */
  conversationWindow?: number;
  /** agent 原始模型配置（contextWindow + 独立摘要模型解析） */
  modelConfig?: ModelConfig;
  /** agent 输出上限（reservedCompletionTokens） */
  maxTokens?: number;
  settings?: Partial<CompactionSettings>;
}
