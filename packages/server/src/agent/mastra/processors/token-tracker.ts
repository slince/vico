// Mastra output processor: Token 用量统计 → token_usage_logs 表

import { v4 as uuid } from 'uuid';
import { getDb, schema } from '../../../db/db.js';

const { token_usage_logs } = schema;

interface TokenTrackerOptions {
  tenantId: string;
  agentId: string;
  modelName: string;
}

/** 创建 Token 用量统计 output processor */
export function createTokenTracker(opts: TokenTrackerOptions) {
  return {
    id: 'token-tracker' as const,
    async processOutputResult(args: any) {
      const usage = args?.usage;
      if (usage) {
        try {
          const db = getDb();
          db.insert(token_usage_logs).values({
            id: uuid(),
            tenant_id: opts.tenantId,
            agent_id: opts.agentId,
            model_name: opts.modelName,
            prompt_tokens: usage.promptTokens || 0,
            completion_tokens: usage.completionTokens || 0,
            created_at: Date.now(),
          }).run();
        } catch { /* non-critical */ }
      }
      return args;
    },
  } as any;
}
