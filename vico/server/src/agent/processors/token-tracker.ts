/**
 * Mastra Output Processor — Token 用量跟踪
 *
 * 每次 LLM 响应完成（processOutputResult）时记录累积 Token 消耗，
 * 输出结构化 JSON 日志。可用于后续接入 Mastra Observability 域做持久化。
 */
import type { OutputProcessor, ProcessOutputResultArgs } from '@mastra/core/processors';
import { createLogger } from '../../lib/logger.js';

const log = createLogger('token-tracker');

/** Token 用量跟踪处理器配置 */
interface TokenTrackerConfig {
  /** 租户 ID */
  tenantId: string;
  /** Agent ID */
  agentId: string;
  /** 当前使用的模型名称 */
  modelName: string;
}

/**
 * 创建 Token 用量跟踪处理器
 *
 * 在 Agent 输出处理管道末尾运行，从 `result.usage` 中读取累积 Token 用量
 * 并输出为结构化日志。
 */
export function createTokenTracker(config: TokenTrackerConfig): OutputProcessor {
  return {
    id: 'token-tracker',
    name: 'Token Usage Tracker',
    description: 'Tracks LLM token consumption per request',

    async processOutputResult(
      args: ProcessOutputResultArgs,
    ) {
      const { usage } = args.result;
      if (!usage) return args.messages;

      log.info({
        tenantId: config.tenantId,
        agentId: config.agentId,
        modelName: config.modelName,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        totalTokens: usage.totalTokens,
        reasoningTokens: usage.reasoningTokens,
        cachedInputTokens: usage.cachedInputTokens,
      }, 'Token usage');

      // 返回原始 messages，不做修改
      return args.messages;
    },
  } as OutputProcessor;
}
