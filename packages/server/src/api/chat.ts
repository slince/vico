import { Hono } from 'hono';
import type { Variables } from '../index.js';
import { getAuthContext } from './helpers.js';
import { runPipeline } from '../agent/pipeline.js';

export function chatRoutes(app: Hono<{ Variables: Variables }>) {
  app.post('/api/v1/chat', async (c) => {
    const auth = getAuthContext(c);
    if (auth instanceof Response) return auth;
    const body = await c.req.json();
    const { agentId, conversationId, message } = body;

    if (!agentId || !message) {
      return c.json({ error: 'agentId and message are required' }, 400);
    }

    const result = await runPipeline(message, {
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
}
