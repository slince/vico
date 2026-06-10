import { streamText, generateText, tool } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { getDb } from '../data/db.js';
import { skillManager } from '../skill/manager.js';
import { toolExecutor } from './tool-executor.js';
import { getDefaultModel, ModelConfigRow } from './model-registry.js';
import { shortTermMemory } from '../memory/short-term.js';
import { longTermMemory } from '../memory/long-term.js';
import { ragManager } from '../memory/rag.js';
import { SkillToolDef } from '../skill/types.js';
import { v4 as uuid } from 'uuid';
import { config } from '../config.js';

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
  const agent = db.prepare('SELECT * FROM agents WHERE id = ? AND tenant_id = ?').get(ctx.agentId, ctx.tenantId) as any;
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
    db.prepare(`INSERT INTO conversations (id, tenant_id, agent_id, user_id, title, model_name, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
      conversationId, ctx.tenantId, ctx.agentId, ctx.userId, '', modelConfig.model_name, now, now
    );
  }

  // 4. Build system prompt
  const skillPrompts = skillManager.getPromptForAgent(ctx.agentId);

  // 5. Retrieve memories
  const stmMessages = shortTermMemory.getContext(conversationId);
  const ltmFacts = await longTermMemory.retrieve(ctx.tenantId, ctx.userId, message);

  // 6. RAG retrieval
  let ragContext = '';
  if (agent.rag_mode !== 'disabled') {
    const kbBindings = db.prepare('SELECT kb_id FROM agent_knowledge_bases WHERE agent_id = ?').all(ctx.agentId) as { kb_id: string }[];
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

  const { textStream, steps } = streamText({
    model,
    system: systemPrompt,
    messages: allMessages as any,
    tools: aiTools,
    maxSteps: 10,
    temperature: agent.temperature ?? 0.7,
    maxTokens: agent.max_tokens ?? 4096,
    onStepFinish: async (event) => {
      // Handle tool calls
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

        // Save user message
        const now = Date.now();
        db.prepare(`INSERT INTO messages (id, conversation_id, role, content, created_at)
          VALUES (?, ?, ?, ?, ?)`).run(uuid(), conversationId, 'user', message, now);

        // Save assistant message
        db.prepare(`INSERT INTO messages (id, conversation_id, role, content, created_at)
          VALUES (?, ?, ?, ?, ?)`).run(uuid(), conversationId, 'assistant', finalText, now);

        // Update conversation
        db.prepare(`UPDATE conversations SET message_count = message_count + 2, updated_at = ? WHERE id = ?`).run(now, conversationId);

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
