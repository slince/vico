// Vico Agent DB 配置 → Mastra Agent 实例构建器
// 整合 4 个 Bridge + 3 个 Processor，构建完整的 Mastra Agent

import { Agent } from '@mastra/core/agent';
import { withMastra } from '@mastra/ai-sdk';
import { eq, and } from 'drizzle-orm';
import { v4 as uuid } from 'uuid';
import { getDb, schema } from '../../db/db.js';
import { resolveAgentModel } from './bridges/model-bridge.js';
import { getSkillToolsForMastraAgent, getSkillPromptForAgent } from './bridges/skill-bridge.js';
import { createRagTool, getRagContext } from './bridges/rag-bridge.js';
import { authToMastraContext } from './bridges/auth-bridge.js';
import { createAuditLogger } from './processors/audit-logger.js';
import { createTokenTracker } from './processors/token-tracker.js';
import { createMessagePersister } from './processors/message-persister.js';
import { getMastraStorage } from './storage.js';
import { longTermMemory } from '../../memory/long-term.js';
import { config } from '../../config.js';

const { agents, conversations } = schema;

export interface PipelineContext {
  tenantId: string;
  agentId: string;
  userId: string;
  conversationId?: string;
}

/** Vico Agent DB 配置 → Mastra Agent 实例 */
export async function createMastraAgent(
  ctx: PipelineContext,
): Promise<{ agent: Agent; conversationId: string; modelName: string }> {
  const db = getDb();

  // 1. 加载 Agent 配置
  const agentRow = db.select().from(agents)
    .where(and(eq(agents.id, ctx.agentId), eq(agents.tenant_id, ctx.tenantId)))
    .get();
  if (!agentRow) throw new Error('Agent not found');

  // 2. 解析模型
  const { model, modelConfig } = resolveAgentModel(ctx.tenantId, agentRow.model_id);

  // 3. 创建或复用 Conversation
  let conversationId = ctx.conversationId;
  if (!conversationId) {
    conversationId = uuid();
    const now = Date.now();
    db.insert(conversations).values({
      id: conversationId,
      tenant_id: ctx.tenantId,
      agent_id: ctx.agentId,
      user_id: ctx.userId,
      title: '',
      model_name: modelConfig.model_name,
      created_at: now,
      updated_at: now,
    }).run();
  }

  // 4. 构建系统提示词
  const skillPrompts = getSkillPromptForAgent(ctx.agentId);
  const ltmFacts = await longTermMemory.retrieve(ctx.tenantId, ctx.userId, '');
  const ragContext = agentRow.rag_mode !== 'disabled'
    ? await getRagContext(ctx.agentId, '')
    : '';

  let systemPrompt = agentRow.system_prompt || '';
  if (skillPrompts) {
    systemPrompt += '\n\n## 技能指南\n' + skillPrompts;
  }
  if (ltmFacts.length > 0) {
    systemPrompt += '\n\n## 相关历史信息\n' + ltmFacts.map((f) => f.content).join('\n');
  }
  if (ragContext) {
    systemPrompt += ragContext;
  }

  // 5. 构建 tools
  const skillTools = getSkillToolsForMastraAgent(ctx.agentId, {
    tenantId: ctx.tenantId,
    agentId: ctx.agentId,
    userId: ctx.userId,
  });

  const ragTool = agentRow.rag_mode !== 'disabled'
    ? createRagTool(ctx.agentId)
    : null;

  const tools: Record<string, any> = { ...skillTools };
  if (ragTool) {
    tools[ragTool.id] = ragTool;
  }

  // 6. 创建 Processors
  const mastraCtx = authToMastraContext(
    { tenantId: ctx.tenantId, userId: ctx.userId },
    conversationId,
  );
  const { inputProcessor, outputProcessor } = createMessagePersister({ conversationId });
  const auditLogger = createAuditLogger({
    tenantId: ctx.tenantId,
    agentId: ctx.agentId,
    conversationId,
  });
  const tokenTracker = createTokenTracker({
    tenantId: ctx.tenantId,
    agentId: ctx.agentId,
    modelName: modelConfig.model_name,
  });

  // 7. 用 withMastra 包裹 model
  const wrappedModel = withMastra(model as any, {
    memory: {
      storage: getMastraStorage() as any,
      threadId: mastraCtx.threadId,
      resourceId: mastraCtx.resourceId,
      lastMessages: config.memory.stm_window * 2,
    },
    inputProcessors: [inputProcessor],
    outputProcessors: [auditLogger, tokenTracker, outputProcessor],
  }) as any;

  // 8. 创建 Mastra Agent
  const agent = new Agent({
    name: agentRow.name,
    instructions: systemPrompt,
    model: wrappedModel,
    tools,
  } as any);

  return {
    agent,
    conversationId,
    modelName: modelConfig.model_name,
  };
}
