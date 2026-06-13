import { streamText, tool } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { eq, and, sql } from 'drizzle-orm';
import { v4 as uuid } from 'uuid';
import { getDb, schema } from '../db/db.js';
import { skillManager } from '../skill/manager.js';
import { toolExecutor } from './tool-executor.js';
import { getDefaultModel, ModelConfigRow } from './model-registry.js';
import { shortTermMemory } from '../memory/short-term.js';
import { longTermMemory } from '../memory/long-term.js';
import { ragManager } from '../memory/rag.js';
import { SkillToolDef } from '../skill/types.js';
import { config } from '../config.js';

const { agents, agent_knowledge_bases, conversations, messages } = schema;

function resolveModelProvider(modelConfig: ModelConfigRow) {
  const apiKey = modelConfig.api_key_encrypted;
  const baseURL = modelConfig.base_url || undefined;

  switch (modelConfig.provider) {
    case 'anthropic':
      return createAnthropic({ apiKey })(modelConfig.model_name);
    case 'deepseek':
    case 'qwen':
    case 'custom':
      return createOpenAI({ apiKey, baseURL })(modelConfig.model_name);
    case 'openai':
    default:
      return createOpenAI({ apiKey, baseURL })(modelConfig.model_name);
  }
}

function toolDefsToAITools(defs: SkillToolDef[]) {
  const toolMap: Record<string, any> = {};
  for (const def of defs) {
    toolMap[def.name] = tool({
      description: def.description,
      parameters: def.parameters as any,
    });
  }
  return toolMap;
}

export interface PipelineContext {
  tenantId: string;
  agentId: string;
  userId: string;
  conversationId?: string;
}

export interface PipelineResult {
  stream: ReadableStream;
  metadata: {
    conversationId: string;
    agentId: string;
    modelName: string;
  };
}

export async function runPipeline(
  message: string,
  ctx: PipelineContext
): Promise<PipelineResult> {
  const db = getDb();

  // 1. Load agent config
  const agent = db.select().from(agents)
    .where(and(eq(agents.id, ctx.agentId), eq(agents.tenant_id, ctx.tenantId)))
    .get();
  if (!agent) throw new Error('Agent not found');

  // 2. Resolve model
  const modelConfig = getDefaultModel(ctx.tenantId);
  if (!modelConfig) throw new Error('No LLM model configured');

  const model = resolveModelProvider(modelConfig);

  // 3. Build conversation
  let conversationId = ctx.conversationId;
  if (!conversationId) {
    conversationId = uuid();
    const now = Date.now();
    db.insert(conversations).values({
      id: conversationId, tenant_id: ctx.tenantId, agent_id: ctx.agentId,
      user_id: ctx.userId, title: '', model_name: modelConfig.model_name,
      created_at: now, updated_at: now,
    }).run();
  }

  // 4. Build system prompt
  const skillPrompts = skillManager.getPromptForAgent(ctx.agentId);

  // 5. Retrieve memories
  const stmMessages = shortTermMemory.getContext(conversationId);
  const ltmFacts = await longTermMemory.retrieve(ctx.tenantId, ctx.userId, message);

  // 6. RAG retrieval
  let ragContext = '';
  if (agent.rag_mode !== 'disabled') {
    const kbBindings = db.select({ kb_id: agent_knowledge_bases.kb_id })
      .from(agent_knowledge_bases).where(eq(agent_knowledge_bases.agent_id, ctx.agentId)).all();
    if (kbBindings.length > 0) {
      const kbIds = kbBindings.map((b) => b.kb_id);
      const chunks = await ragManager.hybridSearch(message, kbIds, config.rag.retrieval_top_k);
      if (chunks.length > 0) {
        ragContext = '\n\n## 相关知识库内容\n' + chunks.map((c) => c.content).join('\n\n');
      }
    }
  }

  // 7. Assemble system prompt
  let systemPrompt = agent.system_prompt || '';
  if (skillPrompts) {
    systemPrompt += '\n\n## 技能指南\n' + skillPrompts;
  }
  if (ltmFacts.length > 0) {
    systemPrompt += '\n\n## 相关历史信息\n' + ltmFacts.map((f) => f.content).join('\n');
  }
  if (ragContext) {
    systemPrompt += ragContext;
  }

  // 8. Get tool definitions
  const toolDefs = skillManager.getToolDefsForAgent(ctx.agentId);

  // 9. Build messages
  const pastMessages = stmMessages.map((m) => ({
    role: m.role as 'user' | 'assistant' | 'system',
    content: m.content,
  }));

  const allMessages = [...pastMessages, { role: 'user' as const, content: message }];

  // 10. Execute stream
  const aiTools = toolDefsToAITools(toolDefs);

  const { textStream } = streamText({
    model,
    system: systemPrompt,
    messages: allMessages as any,
    tools: aiTools,
    maxSteps: 10,
    temperature: agent.temperature ?? 0.7,
    maxTokens: agent.max_tokens ?? 4096,
    onStepFinish: async (event) => {
      if (event.toolCalls && event.toolCalls.length > 0) {
        for (const toolCall of event.toolCalls) {
          const execResult = await toolExecutor.execute(
            toolCall.toolName,
            toolCall.args,
            {
              tenantId: ctx.tenantId,
              agentId: ctx.agentId,
              skillConfig: {},
              userId: ctx.userId,
            }
          );
          console.log(`[Tool] ${toolCall.toolName}:`, execResult.success ? 'OK' : 'FAILED');
        }
      }
    },
  });

  // 11. Persist messages after complete
  let finalText = '';
  const encoder = new TextEncoder();
  const readableStream = new ReadableStream({
    async start(controller) {
      try {
        for await (const text of textStream) {
          finalText += text;
          const event = JSON.stringify({ type: 'text_delta', content: text });
          controller.enqueue(encoder.encode(`data: ${event}\n\n`));
        }

        // Save messages
        const now = Date.now();
        db.insert(messages).values({
          id: uuid(), conversation_id: conversationId, role: 'user', content: message, created_at: now,
        }).run();
        db.insert(messages).values({
          id: uuid(), conversation_id: conversationId, role: 'assistant', content: finalText, created_at: now,
        }).run();

        // Update conversation
        db.update(conversations).set({
          message_count: sql`message_count + 2`,
          updated_at: now,
        }).where(eq(conversations.id, conversationId)).run();

        // Update short-term memory
        shortTermMemory.push(conversationId, { role: 'user', content: message, timestamp: now });
        shortTermMemory.push(conversationId, { role: 'assistant', content: finalText, timestamp: now });

        // Extract long-term facts (async, non-blocking)
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

/**
 * 统一入口：根据 config.server.agent_engine 选择 Mastra 或 Legacy pipeline。
 * 前端和 API 路由层无需感知引擎切换。
 * Mastra 失败时自动回退到 Legacy pipeline。
 */
export async function runChatPipeline(
  message: string,
  ctx: PipelineContext,
): Promise<PipelineResult> {
  const engine = config.server.agent_engine || 'legacy';

  if (engine === 'mastra') {
    try {
      const { createMastraAgent } = await import('./mastra/index.js');
      const { agent, conversationId, modelName } = await createMastraAgent(ctx);

      const result = await (agent.stream as any)(message, {
        threadId: ctx.conversationId || '',
        resourceId: ctx.tenantId,
      });

      return mastraStreamToPipelineResult(result, conversationId, ctx.agentId, modelName, message, ctx);
    } catch (err) {
      console.error('[Mastra] Error, falling back to legacy pipeline:', err);
    }
  }

  return runPipeline(message, ctx);
}

/**
 * 将 Mastra Agent stream 结果转换为 Vico SSE 格式的 PipelineResult。
 * 保持 data: {"type":"text_delta","content":"..."}\n\n 格式不变。
 */
function mastraStreamToPipelineResult(
  mastraResult: any,
  conversationId: string,
  agentId: string,
  modelName: string,
  message: string,
  ctx: PipelineContext,
): PipelineResult {
  const encoder = new TextEncoder();
  let finalText = '';

  const readableStream = new ReadableStream({
    async start(controller) {
      try {
        if (mastraResult.textStream) {
          for await (const text of mastraResult.textStream) {
            finalText += text;
            const event = JSON.stringify({ type: 'text_delta', content: text });
            controller.enqueue(encoder.encode(`data: ${event}\n\n`));
          }
        } else if (mastraResult[Symbol.asyncIterator]) {
          for await (const chunk of mastraResult) {
            const text = chunk?.text || chunk?.content || chunk?.textDelta || '';
            if (text) {
              finalText += text;
              const event = JSON.stringify({ type: 'text_delta', content: text });
              controller.enqueue(encoder.encode(`data: ${event}\n\n`));
            }
          }
        } else if (mastraResult.stream) {
          const reader = mastraResult.stream.getReader();
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const text = typeof value === 'string' ? value : new TextDecoder().decode(value);
            finalText += text;
            const event = JSON.stringify({ type: 'text_delta', content: text });
            controller.enqueue(encoder.encode(`data: ${event}\n\n`));
          }
        }

        const now = Date.now();
        const db = getDb();

        db.update(conversations).set({
          message_count: sql`message_count + 2`,
          updated_at: now,
        }).where(eq(conversations.id, conversationId)).run();

        shortTermMemory.push(conversationId, { role: 'user', content: message, timestamp: now });
        shortTermMemory.push(conversationId, { role: 'assistant', content: finalText, timestamp: now });

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
    metadata: { conversationId, agentId, modelName },
  };
}
