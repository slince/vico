import { v4 as uuidv4 } from 'uuid';
import { RequestContext } from '@mastra/core/request-context';
import { mastra } from '../mastra.js';
import { createSSEStream } from '../agent/sse-utils.js';
import { getMemory } from '../agent/memory-setup.js';
import { agentManager } from '../services/agent/agent-manager.js';
import { prepareAgentContext, AgentNotFoundError } from '../agent/agent.factory.js';
import { agentToolStore } from '../agent/tools/agent-tool-store.js';
import { builtinToolManager } from '../agent/tools/builtin/index.js';
import { modelManager } from '../services/model/model-manager.js';
import { resolveModelProvider } from '../agent/bridges/model-bridge.js';
import { workingMemory } from '../agent/memory/working-memory.js';
import type { MastraModelOutput } from '@mastra/core/stream';
import type { MastraModelConfig } from '@mastra/core/llm';
import type { LanguageModel } from 'ai';
import logger from '../lib/logger.js';

export interface ExecuteChatParams {
  agentId: string;
  message: string;
  conversationId?: string;
  tenantId: string;
  userId: string;
}

/**
 * 执行单 Agent 对话。
 *
 * - agentId === 'main' 时使用内置 mainAgent（通用调度器，带租户 Agent 工具），
 *   其配置（模型、系统提示词、maxSteps）从 DB 中 is_default=1 的 Agent 记录加载
 * - 其他 agentId 从 DB 查找配置，通过 agentProxy 模板注入运行时参数
 * - 通过 SSE 流式返回 AI 回复
 */
export async function executeAgentChat(params: ExecuteChatParams): Promise<Response> {
  const { agentId, message, conversationId, tenantId, userId } = params;

  // 输入校验
  if (!message?.trim()) {
    return new Response(JSON.stringify({ error: 'Message is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const cid = conversationId || uuidv4();
    // 使用 :: 分隔符避免 UUID 中的 - 造成 thread ID 歧义
    const threadId = `${agentId}::${userId}::${cid}`;

    const requestContext = new RequestContext();

    let output: MastraModelOutput<unknown>;
    let instructions: string;
    // 追踪实际使用的模型，供 onComplete 中 working memory 提取使用
    let activeModel: MastraModelConfig | null = null;

    if (agentId === 'main') {
      // 内置主 Agent — 通用调度器，配置从 DB 中 is_default=1 的记录加载
      const mainAgentRecord = await agentManager.getDefault(tenantId);
      const mainConfig = mainAgentRecord
        ? await agentManager.getAgentRuntimeConfig(tenantId, mainAgentRecord.id)
        : null;

      if (mainConfig) {
        activeModel = mainConfig.model;
        requestContext.set('model', activeModel);
        instructions = mainConfig.instructions;
      } else {
        // 回退：使用租户默认模型
        const defaultModelConfig = await modelManager.getDefault(tenantId);
        if (defaultModelConfig) {
          activeModel = resolveModelProvider(defaultModelConfig);
          requestContext.set('model', activeModel);
        }
        instructions = await mastra.getAgent('mainAgent').getInstructions() as string;
      }

      const vicoAgent = mastra.getAgent('mainAgent');

      const agentTools = await agentToolStore.getToolsForTenant(tenantId);
      const agentDescriptions = await agentToolStore.getAgentDescriptions(tenantId);

      // 内置工具从 DB 记录的 builtin_tools 配置加载（有记录则用记录，否则全开）
      const builtinTools = await builtinToolManager.getToolsForAgent(
        mainAgentRecord || { builtin_tools: '{"read":true,"write":true,"edit":true,"ls":true,"grep":true,"stat":true}' },
        tenantId,
      );

      const allTools = { ...builtinTools, ...agentTools };
      if (Object.keys(allTools).length > 0) {
        requestContext.set('tools', allTools);
      }

      if (agentDescriptions) {
        instructions += `\n\n## 当前可用的专业 Agent\n\n${agentDescriptions}`;
      }

      const maxSteps = mainConfig?.agent.max_steps ?? 15;

      // 验证通过后再创建 thread
      await saveThread(threadId, tenantId, {
        agent_id: agentId,
        user_id: userId,
        model_name: mainAgentRecord?.model_id || '',
      });

      output = await vicoAgent.stream([{ role: 'user', content: message }], {
        instructions,
        memory: { thread: threadId, resource: tenantId },
        maxSteps,
        requestContext,
      });
    } else {
      // 用户自定义 Agent — 加载运行时配置并注入 requestContext
      let maxSteps: number;
      let model_id: string;
      try {
        const ctx = await prepareAgentContext(tenantId, agentId, requestContext);
        activeModel = ctx.model;
        instructions = ctx.instructions;
        model_id = ctx.agent.model_id;
        maxSteps = ctx.agent.max_steps ?? 10;
      } catch (error: unknown) {
        if (error instanceof AgentNotFoundError) {
          return new Response(JSON.stringify({ error: error.message }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        throw error;
      }

      await saveThread(threadId, tenantId, {
        agent_id: agentId,
        user_id: userId,
        model_name: model_id,
      });

      const agentProxy = mastra.getAgent('agentProxy');
      output = await agentProxy.stream([{ role: 'user', content: message }], {
        instructions,
        memory: { thread: threadId, resource: tenantId },
        maxSteps,
        requestContext,
      });
    }

    // 包装为 SSE 流，流结束后异步提取工作记忆
    const stream = createSSEStream(output, {
      onComplete: async (fullText: string) => {
        if (!activeModel) return;
        // MastraModelConfig 兼容 AI SDK LanguageModel（LanguageModelV1/V2/V3 联合类型）
        await workingMemory.extractAndStore(
          activeModel as unknown as LanguageModel,
          tenantId,
          userId,
          [
            { role: 'user', content: message },
            { role: 'assistant', content: fullText },
          ],
        );
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'An internal error occurred';
    logger.error({ err: error, agentId, tenantId }, 'Chat stream error');
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

/** 写入 thread 到 memory，避免重复的 saveThread 样板代码 */
async function saveThread(
  threadId: string,
  tenantId: string,
  metadata: Record<string, string>,
): Promise<void> {
  const memory = getMemory();
  await memory.saveThread({
    thread: {
      id: threadId,
      resourceId: tenantId,
      title: '',
      createdAt: new Date(),
      updatedAt: new Date(),
      metadata,
    },
  });
}
