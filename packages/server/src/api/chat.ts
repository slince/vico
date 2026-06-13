import { Hono } from 'hono';
import { v4 as uuidv4 } from 'uuid';
import type { Variables } from '../index.js';
import { getAuthContext } from './helpers.js';
import { mastra } from '../mastra.js';
import { agentToolCache } from '../agent/cache/agent-tool-cache.js';
import { createSSEStream, createNetworkSSEStream } from '../agent/sse-utils.js';
import { getMemory } from '../agent/memory-setup.js';
import { modelManager } from '../services/model/model-manager.js';
import { resolveModelProvider } from '../agent/bridges/model-bridge.js';
import { workingMemory } from '../agent/memory/working-memory.js';
import type { LanguageModel } from 'ai';
import logger from '../lib/logger.js';

export function chatRoutes(app: Hono<{ Variables: Variables }>) {
  /** 单 Agent 对话 — 使用 VicoMainAgent 调度器 + 动态注入租户 Agent 工具 */
  app.post('/api/v1/chat', async (c) => {
    const auth = await getAuthContext(c);
    if (auth instanceof Response) return auth;

    try {
      const body = await c.req.json();
      const { agentId, message, conversationId } = body;
      if (!agentId || !message) {
        return c.json({ error: 'agentId and message are required' }, 400);
      }

      // 为每个对话生成唯一标识，实现对话隔离
      const cid = conversationId || uuidv4();
      const threadId = `${agentId}-${auth.userId}-${cid}`;

      // 获取模型名称，存入 thread metadata
      const modelConfig = await modelManager.getDefault(auth.tenantId);
      const modelName = modelConfig?.model_name || '';

      // 预先创建 Mastra thread，保存 Agent/用户/模型 等元信息
      const memory = getMemory();
      await memory.saveThread({
        thread: {
          id: threadId,
          resourceId: auth.tenantId,
          title: '',
          createdAt: new Date(),
          updatedAt: new Date(),
          metadata: {
            agent_id: agentId,
            user_id: auth.userId,
            model_name: modelName,
          },
        },
      });

      // 获取 VicoMainAgent — 通用任务路由调度器
      const vicoAgent = mastra.getAgent('vicoMainAgent');

      // 获取租户自定义 Agent 对应的动态工具和能力描述
      const agentTools = await agentToolCache.getToolsForTenant(auth.tenantId);
      const agentDescriptions = await agentToolCache.getAgentDescriptions(auth.tenantId);

      // 构建动态 instructions：原始 prompt + 当前可用专业 Agent 列表
      const baseInstructions = await vicoAgent.getInstructions();
      const dynamicInstructions = agentDescriptions
        ? `\n\n## 当前可用的专业 Agent\n\n${agentDescriptions}`
        : '';

      // 执行流式对话 — 使用 stream() 注入动态工具和增强 instructions
      const output = await vicoAgent.stream([{ role: 'user', content: message }], {
        clientTools: agentTools,
        instructions: baseInstructions + dynamicInstructions,
        memory: {
          thread: threadId,
          resource: auth.tenantId,
        },
        maxSteps: 15,
      });

      // 包装为 SSE 流，流结束后异步提取工作记忆
      const userMessage = message as string;
      const stream = createSSEStream(output, {
        onComplete: async (fullText: string) => {
          const modelConfig = await modelManager.getDefault(auth.tenantId);
          if (!modelConfig) return;
          const model = resolveModelProvider(modelConfig) as unknown as LanguageModel;
          await workingMemory.extractAndStore(model, auth.tenantId, auth.userId, [
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
      logger.error({ err: error }, 'Chat stream error');
      return c.json(
        { error: message },
        500,
      );
    }
  });

  /** 团队对话 — 基于 Mastra agent.network() 的多 Agent 协作 */
  app.post('/api/v1/teams/:id/chat', async (c) => {
    const auth = await getAuthContext(c);
    if (auth instanceof Response) return auth;
    const teamId = c.req.param('id');
    const body = await c.req.json();
    const { message } = body;
    if (!message) return c.json({ error: 'message is required' }, 400);

    try {
      const { createTeamNetwork } = await import('../agent/team-network.js');
      const { stream } = await createTeamNetwork(teamId, message, {
        tenantId: auth.tenantId,
        userId: auth.userId,
      });

      const sseStream = createNetworkSSEStream(stream);

      return new Response(sseStream, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        },
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'An internal error occurred';
      logger.error({ err: error, teamId }, 'Team chat error');
      return c.json({ error: message }, 500);
    }
  });
}
