import { v4 as uuidv4 } from 'uuid';
import { RequestContext } from '@mastra/core/request-context';
import { mastra } from '../mastra.js';
import { createSSEStream } from '../agent/sse-utils.js';
import { getMemory } from '../agent/memory-setup.js';
import { agentManager } from '../services/agent/agent-manager.js';
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
 * 根据 agentId 查找数据库中用户选择的 Agent 配置，
 * 使用 agentProxy 模板注入运行时配置（模型、instructions），
 * 通过 SSE 流式返回 AI 回复。
 *
 * @param params - 包含 agentId、message、conversationId、tenantId、userId
 * @returns SSE Response 对象，或错误时返回 JSON Response
 */
export async function executeAgentChat(params: ExecuteChatParams): Promise<Response> {
  const { agentId, message, conversationId, tenantId, userId } = params;

  try {
    // 获取目标 Agent 的运行时配置（模型 + 编译后的 instructions）
    const agentConfig = await agentManager.getAgentRuntimeConfig(tenantId, agentId);
    if (!agentConfig) {
      return new Response(JSON.stringify({ error: 'Agent not found' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // 为每个对话生成唯一标识，实现对话隔离
    const cid = conversationId || uuidv4();
    const threadId = `${agentId}-${userId}-${cid}`;

    // 获取租户默认模型配置（用于元信息记录）
    const modelConfig = await modelManager.getDefault(tenantId);
    const modelName = modelConfig?.model_name || '';

    // 预先创建 Mastra thread，保存 Agent/用户/模型 等元信息
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

    // 使用 agentProxy 模板 + requestContext 注入运行时配置
    const agentProxy = mastra.getAgent('agentProxy');

    const requestContext = new RequestContext();
    requestContext.set('model', agentConfig.model);
    requestContext.set('instructions', agentConfig.instructions);

    // 执行流式对话
    const output = await agentProxy.stream([{ role: 'user', content: message }], {
      instructions: agentConfig.instructions,
      memory: {
        thread: threadId,
        resource: tenantId,
      },
      maxSteps: agentConfig.maxSteps,
      requestContext,
    });

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
