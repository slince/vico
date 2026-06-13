// Mastra output processor: 工具调用审计 → tool_call_logs 表

import { v4 as uuid } from 'uuid';
import { getDb, schema } from '../../../db/db.js';

const { tool_call_logs } = schema;

interface AuditLoggerOptions {
  tenantId: string;
  agentId: string;
  conversationId: string;
}

/** 创建工具调用审计 output processor */
export function createAuditLogger(opts: AuditLoggerOptions) {
  return {
    id: 'audit-logger' as const,
    async processOutputResult(args: any) {
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
        } catch { /* non-critical */ }
      }
      return args;
    },
  } as any;
}
