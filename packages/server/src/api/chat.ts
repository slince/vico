import { Hono } from 'hono';
import type { Variables } from '../index.js';
import { getAuthContext } from './helpers.js';
import { createNetworkSSEStream } from '../agent/sse-utils.js';
import { executeAgentChat, executeAgentChatRaw } from '../chat/chat.js';
import logger from '../lib/logger.js';

export function chatRoutes(app: Hono<{ Variables: Variables }>) {
  /** 单 Agent 对话 — 使用用户选择的 Agent 进行对话 */
  app.post('/api/v1/chat', async (c) => {
    const auth = await getAuthContext(c);
    if (auth instanceof Response) return auth;

    const body = await c.req.json();
    const { agentId, message, threadId } = body;
    if (!agentId || !message) {
      return c.json({ error: 'agentId and message are required' }, 400);
    }

    return executeAgentChat({
      agentId,
      message,
      threadId,
      tenantId: auth.tenantId,
      userId: auth.userId,
    });
  });

  /** 单 Agent 对话 — AI SDK 协议 */
  app.post('/api/v1/chat/ai-sdk', async (c) => {
    const auth = await getAuthContext(c);
    if (auth instanceof Response) return auth;

    const body = await c.req.json();
    const { agentId, message, threadId } = body;
    if (!agentId || !message) {
      return c.json({ error: 'agentId and message are required' }, 400);
    }

    try {
      const { thread, output } = await executeAgentChatRaw({
        agentId,
        message,
        threadId,
        tenantId: auth.tenantId,
        userId: auth.userId,
      });

      const { createAISDKStream } = await import('../agent/ai-sdk-stream.js');
      return createAISDKStream(output, {
        doneMetadata: { threadId: thread },
      });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'An internal error occurred';
      logger.error({ err: error, agentId, tenantId: auth.tenantId }, 'Chat AI SDK stream error');
      return c.json({ error: msg }, 500);
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

  /** 团队对话 — AI SDK 协议 */
  app.post('/api/v1/teams/:id/chat/ai-sdk', async (c) => {
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

      const { createNetworkAISDKStream } = await import('../agent/ai-sdk-stream.js');
      return createNetworkAISDKStream(stream);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'An internal error occurred';
      logger.error({ err: error, teamId }, 'Team chat AI SDK stream error');
      return c.json({ error: msg }, 500);
    }
  });
}
