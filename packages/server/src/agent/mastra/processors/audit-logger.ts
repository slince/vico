// Mastra output processor: 工具调用审计 → tool_call_logs 表
// Mastra 每次工具调用完成后触发，记录到 Vico 的 tool_call_logs 表

import { v4 as uuid } from 'uuid';
import { getDb, schema } from '../../../db/db.js';

const { tool_call_logs } = schema;

interface AuditLoggerOptions {
  tenantId: string;
  agentId: string;
  conversationId: string;
}

/**
 * 创建工具调用审计 output processor。
 * 记录每次工具调用的名称、参数、结果、状态和耗时。
 */
export function createAuditLogger(opts: AuditLoggerOptions) {
  return {
    type: 'output' as const,
    name: 'audit-logger',
    async process(args: { result: any; toolCalls?: any[] }) {
      const toolCalls = args?.toolCalls || [];
      for (const tc of toolCalls) {
        try {
          const db = getDb();
          db.insert(tool_call_logs).values({
            id: uuid(),
            tenant_id: opts.tenantId,
            agent_id: opts.agentId,
            conversation_id: opts.conversationId,
            message_id: '',
            tool_name: tc.toolName || tc.name || 'unknown',
            args: JSON.stringify(tc.args || {}),
            result: tc.result ? JSON.stringify(tc.result) : '',
            status: tc.status || 'success',
            duration_ms: tc.durationMs || 0,
            created_at: Date.now(),
          }).run();
        } catch {
          // 审计日志写入失败不阻塞主流程
        }
      }
      return args;
    },
  };
}
