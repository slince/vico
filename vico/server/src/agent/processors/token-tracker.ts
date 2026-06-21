/**
 * Token 用量跟踪 — 不再依赖 Mastra OutputProcessor。
 */
import { createLogger } from '../../lib/logger.js';

const log = createLogger('token-tracker');

interface TokenTrackerConfig {
  tenantId: string;
  agentId: string;
  modelName: string;
}

/** 创建 Token 用量跟踪器 */
export function createTokenTracker(config: TokenTrackerConfig) {
  return {
    logUsage(usage: { input: number; output: number }) {
      log.info({
        tenantId: config.tenantId,
        agentId: config.agentId,
        modelName: config.modelName,
        inputTokens: usage.input,
        outputTokens: usage.output,
      }, 'Token usage');
    },
  };
}
