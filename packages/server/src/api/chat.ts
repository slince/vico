import { Hono } from 'hono';
import type { Variables } from '../index.js';
import { getAuthContext } from './helpers.js';
import { runChatPipeline } from '../agent/pipeline.js';
import { runTeamPipeline } from '../agent/orchestrator.js';

export function chatRoutes(app: Hono<{ Variables: Variables }>) {
  /** 单 Agent 对话 */
  app.post('/api/v1/chat', async (c) => {
    const auth = getAuthContext(c);
    if (auth instanceof Response) return auth;
    const body = await c.req.json();
    const { agentId, conversationId, message } = body;

    if (!agentId || !message) {
      return c.json({ error: 'agentId and message are required' }, 400);
    }

    const result = await runChatPipeline(message, {
      tenantId: auth.tenantId,
      agentId,
      userId: auth.userId,
      conversationId: conversationId || undefined,
    });

    return new Response(result.stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Conversation-Id': result.metadata.conversationId,
      },
    });
  });

  /** 团队对话 */
  app.post('/api/v1/teams/:id/chat', async (c) => {
    const auth = getAuthContext(c);
    if (auth instanceof Response) return auth;
    const teamId = c.req.param('id');
    const body = await c.req.json();
    const { message, conversationId } = body;

    if (!message) {
      return c.json({ error: 'message is required' }, 400);
    }

    const result = await runTeamPipeline(teamId, message, {
      tenantId: auth.tenantId,
      agentId: teamId,
      userId: auth.userId,
      conversationId: conversationId || undefined,
    });

    return new Response(result.stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Conversation-Id': result.metadata.conversationId,
      },
    });
  });
}
