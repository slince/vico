/**
 * Mastra Output Processor — 工具调用审计日志
 *
 * 每次 agentic loop 结束（processOutputResult）时，遍历所有 step 中的工具调用记录，
 * 输出结构化 JSON 日志。可用于后续接入 Mastra Observability 域做持久化。
 */
import type { OutputProcessor, ProcessOutputResultArgs } from '@mastra/core/processors';

/** 审计日志处理器配置 */
interface AuditLoggerConfig {
  /** 租户 ID */
  tenantId: string;
  /** Agent ID */
  agentId: string;
  /** 会话 ID（可选） */
  conversationId?: string;
}

/**
 * 创建工具调用审计日志处理器
 *
 * 在 Agent 输出处理管道末尾运行，从 `result.steps` 中提取所有 tool-call 记录
 * 并输出为结构化日志。
 */
export function createAuditLogger(config: AuditLoggerConfig): OutputProcessor {
  return {
    id: 'audit-logger',
    name: 'Tool Audit Logger',
    description: 'Records tool call results for audit trail across all steps',

    async processOutputResult(
      args: ProcessOutputResultArgs,
    ) {
      const { steps } = args.result;
      if (!steps || steps.length === 0) return args.messages;

      for (const step of steps) {
        const { toolCalls } = step;
        if (!toolCalls || toolCalls.length === 0) continue;

        for (const tc of toolCalls) {
          console.log(
            JSON.stringify({
              component: 'audit',
              tenantId: config.tenantId,
              agentId: config.agentId,
              conversationId: config.conversationId,
              toolName: tc.payload.toolName,
              toolCallId: tc.payload.toolCallId,
              status: 'completed',
              timestamp: Date.now(),
            }),
          );
        }
      }

      // 返回原始 messages，不做修改
      return args.messages;
    },
  } as OutputProcessor;
}
