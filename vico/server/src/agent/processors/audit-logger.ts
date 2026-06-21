/**
 * 工具调用审计日志处理器 — 不再依赖 Mastra OutputProcessor。
 */
import { createLogger } from '../../lib/logger.js';

const log = createLogger('audit');

interface AuditLoggerConfig {
  tenantId: string;
  agentId: string;
  threadId?: string;
}

/** 创建审计日志记录器 */
export function createAuditLogger(config: AuditLoggerConfig) {
  return {
    logToolCall(toolName: string, toolCallId: string) {
      log.info({
        tenantId: config.tenantId,
        agentId: config.agentId,
        threadId: config.threadId,
        toolName,
        toolCallId,
        status: 'completed',
      }, 'Tool call completed');
    },
  };
}
