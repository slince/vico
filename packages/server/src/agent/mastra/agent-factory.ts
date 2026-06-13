// Vico Agent → Enhanced AI SDK v4 Pipeline
// 整合 4 个 Bridge + 3 个 Processor，构建增强版 Agent 执行管道
//
// 注：原本计划使用 Mastra Agent 类，但 Mastra v1.42 内部捆绑 AI SDK v5/v6，
// 与项目使用的 AI SDK v4 不兼容（类型/协议层面均不兼容）。
// 因此直接使用 AI SDK v4 streamText，保留 Bridge + Processor 架构，
// 待 Mastra 支持 AI SDK v4 后再切换。

import { streamText, tool } from 'ai';
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
import { longTermMemory } from '../../memory/long-term.js';
import { shortTermMemory } from '../../memory/short-term.js';
import { config } from '../../config.js';

const { agents, conversations } = schema;

export interface PipelineContext {
  tenantId: string;
  agentId: string;
  userId: string;
  conversationId?: string;
}

export interface EnhancedPipelineResult {
  stream: ReadableStream;
  metadata: {
    conversationId: string;
    agentId: string;
    modelName: string;
  };
}

/**
 * 创建增强版 Agent 执行管道。
 * 使用 AI SDK v4 streamText，集成 4 个 Bridge 和 3 个 Processor。
 * 相比 legacy pipeline 额外提供：审计日志、Token 统计、增强消息持久化。
 */
export async function createMastraAgent(
  ctx: PipelineContext,
  message: string,
): Promise<EnhancedPipelineResult> {
  const db = getDb();

  // 1. 加载 Agent 配置
  const agentRow = db.select().from(agents)
    .where(and(eq(agents.id, ctx.agentId), eq(agents.tenant_id, ctx.tenantId)))
    .get();
  if (!agentRow) throw new Error('Agent not found');

  // 2. Bridge: 解析模型
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

  // 4. Bridge: 构建系统提示词
  const skillPrompts = getSkillPromptForAgent(ctx.agentId);
  const ltmFacts = await longTermMemory.retrieve(ctx.tenantId, ctx.userId, message);

  let ragContext = '';
  if (agentRow.rag_mode !== 'disabled') {
    ragContext = await getRagContext(ctx.agentId, message);
  }

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

  // 5. Bridge: 构建 tools（Skill tools + RAG tool）
  const mastraTools = getSkillToolsForMastraAgent(ctx.agentId, {
    tenantId: ctx.tenantId,
    agentId: ctx.agentId,
    userId: ctx.userId,
  });

  // 转换为 AI SDK v4 tool 格式（将 Mastra tool 的 inputSchema 转为 parameters）
  const aiTools: Record<string, any> = {};
  for (const [name, mt] of Object.entries(mastraTools)) {
    aiTools[name] = tool({
      description: mt.description,
      parameters: mt.inputSchema,
      execute: async (args: any) => {
        const result = await mt.execute({ context: { args } });
        return result;
      },
    });
  }

  const ragTool = agentRow.rag_mode !== 'disabled'
    ? createRagTool(ctx.agentId)
    : null;
  if (ragTool) {
    aiTools[ragTool.id] = tool({
      description: ragTool.description,
      parameters: ragTool.inputSchema,
      execute: async (args: any) => {
        const result = await ragTool.execute({ context: { args } });
        return result;
      },
    });
  }

  // 6. Processor: 创建回调
  const mastraCtx = authToMastraContext(
    { tenantId: ctx.tenantId, userId: ctx.userId },
    conversationId,
  );

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

  const { inputProcessor, outputProcessor } = createMessagePersister({
    conversationId,
    tenantId: ctx.tenantId,
    userId: ctx.userId,
  });

  // 7. 获取短期记忆
  const stmMessages = shortTermMemory.getContext(conversationId);

  // 8. 构建消息列表
  const pastMessages = stmMessages.map((m) => ({
    role: m.role as 'user' | 'assistant' | 'system',
    content: m.content,
  }));
  const allMessages = [...pastMessages, { role: 'user' as const, content: message }];

  // 9. 执行 streamText（AI SDK v4，含 Processor 回调）
  let finalText = '';

  const { textStream } = streamText({
    model: model as any,
    system: systemPrompt,
    messages: allMessages as any,
    tools: aiTools,
    maxSteps: 10,
    temperature: agentRow.temperature ?? 0.7,
    maxTokens: agentRow.max_tokens ?? 4096,
    onStepFinish: async (event) => {
      // Processor: audit-logger (tool calls)
      if (event.toolCalls && event.toolCalls.length > 0) {
        await auditLogger.processOutputResult({ toolCalls: event.toolCalls }).catch(() => {});
      }
    },
    onFinish: async (event) => {
      // Processor: token-tracker
      if (event.usage) {
        await tokenTracker.processOutputResult({ usage: event.usage }).catch(() => {});
      }
      // Processor: message-persister (output)
      finalText = event.text || '';
      if (finalText) {
        await outputProcessor.processOutputResult({ text: finalText }).catch(() => {});
      }
    },
  });

  // 10. 将 textStream + onFinish 的 finalText 包装为 SSE ReadableStream
  const encoder = new TextEncoder();
  const readableStream = new ReadableStream({
    async start(controller) {
      try {
        // Processor: message-persister (input) — 记录用户消息
        await inputProcessor.processInput({ messages: allMessages }).catch(() => {});

        let streamedText = '';
        for await (const text of textStream) {
          streamedText += text;
          const event = JSON.stringify({ type: 'text_delta', content: text });
          controller.enqueue(encoder.encode(`data: ${event}\n\n`));
        }

        // 若 onFinish 未触发（某些 provider 不支持），使用 streamedText
        if (!finalText && streamedText) {
          finalText = streamedText;
          await outputProcessor.processOutputResult({ text: finalText }).catch(() => {});
        }

        // 更新短期记忆
        const now = Date.now();
        shortTermMemory.push(conversationId, { role: 'user', content: message, timestamp: now });
        shortTermMemory.push(conversationId, { role: 'assistant', content: finalText, timestamp: now });

        // 提取长期记忆（异步，非阻塞）
        if (config.memory.ltm_auto_extract) {
          longTermMemory.extractAndStore(ctx.tenantId, ctx.userId, [
            { role: 'user', content: message },
            { role: 'assistant', content: finalText },
          ]).catch(() => {});
        }

        const doneEvent = JSON.stringify({ type: 'done', usage: {} });
        controller.enqueue(encoder.encode(`data: ${doneEvent}\n\n`));
        controller.close();
      } catch (err: any) {
        const errorEvent = JSON.stringify({ type: 'error', message: err.message });
        controller.enqueue(encoder.encode(`data: ${errorEvent}\n\n`));
        controller.close();
      }
    },
  });

  return {
    stream: readableStream,
    metadata: {
      conversationId,
      agentId: ctx.agentId,
      modelName: modelConfig.model_name,
    },
  };
}
