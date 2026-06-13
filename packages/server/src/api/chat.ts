import { Hono } from 'hono';
import { v4 as uuidv4 } from 'uuid';
import type { Variables } from '../index.js';
import { getAuthContext } from './helpers.js';
import { createAgent } from '../agent/agent-factory.js';
import { createSSEStream, createNetworkSSEStream } from '../agent/sse-utils.js';
import logger from '../lib/logger.js';

export function chatRoutes(app: Hono<{ Variables: Variables }>) {
  /** 单 Agent 对话 — 使用 Mastra Agent */
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

      // 创建 Mastra Agent
      const agent = await createAgent({
        tenantId: auth.tenantId,
        agentId,
        userId: auth.userId,
      });

      // 执行流式对话 — Mastra Agent 自动处理 memory/thread
      const output = await agent.stream([{ role: 'user', content: message }], {
        memory: {
          thread: `${agentId}-${auth.userId}-${cid}`,
          resource: auth.tenantId,
        },
      });

      // 包装为 SSE 流
      const stream = createSSEStream(output);

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
