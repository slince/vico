import { v4 as uuidv4 } from 'uuid';
import { RequestContext } from '@mastra/core/request-context';
import { mastra } from '../mastra.js';
import { createSSEStream } from '../agent/sse-utils.js';
import { getMemory } from '../agent/memory-setup.js';
import { agentManager } from '../services/agent/agent-manager.js';
import { agentToolCache } from '../agent/cache/agent-tool-cache.js';
import { modelManager } from '../services/model/model-manager.js';
import { resolveModelProvider } from '../agent/bridges/model-bridge.js';
import { workingMemory } from '../agent/memory/working-memory.js';
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
 * - agentId === 'main' 时使用内置 mainAgent（通用调度器，带租户 Agent 工具）
 * - 其他 agentId 从 DB 查找配置，通过 agentProxy 模板注入运行时参数
 * - 通过 SSE 流式返回 AI 回复
 */
export async function executeAgentChat(params: ExecuteChatParams): Promise<Response> {
  const { agentId, message, conversationId, tenantId, userId } = params;

  try {
    const cid = conversationId || uuidv4();
    const threadId = `${agentId}-${userId}-${cid}`;

    const modelConfig = await modelManager.getDefault(tenantId);
    const modelName = modelConfig?.model_name || '';

    const memory = getMemory();
    await memory.saveThread({
      thread: {
        id: threadId,
        resourceId: tenantId,
        title: '',
        createdAt: new Date(),
        updatedAt: new Date(),
        metadata: {
          agent_id: agentId,
          user_id: userId,
          model_name: modelName,
        },
      },
    });

    // 构建 requestContext，注入租户默认模型
    const requestContext = new RequestContext();
    if (modelConfig) {
      const model = resolveModelProvider(modelConfig);
      requestContext.set('model', model);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let output: any;
    let instructions: string;

    if (agentId === 'main') {
      // 内置主 Agent — 通用调度器，注入租户 Agent 工具
      const vicoAgent = mastra.getAgent('mainAgent');

      const agentTools = await agentToolCache.getToolsForTenant(tenantId);
      const agentDescriptions = await agentToolCache.getAgentDescriptions(tenantId);

      instructions = `${await vicoAgent.getInstructions()}${agentDescriptions ? `\n\n## 当前可用的专业 Agent\n\n${agentDescriptions}` : ''}`;

      output = await vicoAgent.stream([{ role: 'user', content: message }], {
        clientTools: agentTools,
        instructions,
        memory: { thread: threadId, resource: tenantId },
        maxSteps: 15,
        requestContext,
      });
    } else {
      // 用户自定义 Agent — 从 DB 获取配置，通过 agentProxy 运行
      const agentConfig = await agentManager.getAgentRuntimeConfig(tenantId, agentId);
      if (!agentConfig) {
        return new Response(JSON.stringify({ error: 'Agent not found' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      requestContext.set('model', agentConfig.model);
      instructions = agentConfig.instructions;

      const agentProxy = mastra.getAgent('agentProxy');
      output = await agentProxy.stream([{ role: 'user', content: message }], {
        instructions,
        memory: { thread: threadId, resource: tenantId },
        maxSteps: agentConfig.maxSteps,
        requestContext,
      });
    }

    // 包装为 SSE 流，流结束后异步提取工作记忆
    const userMessage = message as string;
    const stream = createSSEStream(output, {
      onComplete: async (fullText: string) => {
        const modelConfig = await modelManager.getDefault(tenantId);
        if (!modelConfig) return;
        const model = resolveModelProvider(modelConfig) as unknown as LanguageModel;
        await workingMemory.extractAndStore(model, tenantId, userId, [
          { role: 'user', content: userMessage },
          { role: 'assistant', content: fullText },
        ]);
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
