// src/api/chat-v2.ts — Vico Agent Framework 聊天端点（替代 Mastra）
import type { Hono, Context } from 'hono';
import { getAuthContext } from './helpers.js';
import { vicoBootstrap, VicoBootstrap } from '../agent/vico-bootstrap.js';
import { agentManager } from '../services/agent/agent-manager.js';
import type { Variables } from '../index.js';

export function chatV2Routes(app: Hono<{ Variables: Variables }>): void {
  app.post('/api/chat-v2', async (c: Context<{ Variables: Variables }>) => {
    const auth = await getAuthContext(c);
    if (auth instanceof Response) return auth;

    const body = await c.req.json();
    const { agentId, message } = body;

    if (!agentId || !message) {
      return c.json({ error: 'agentId and message are required' }, 400);
    }

    // 1. 加载 Agent 配置
    const detail = await agentManager.getById(auth.tenantId, agentId);
    if (!detail) return c.json({ error: 'Agent not found' }, 404);

    const config = VicoBootstrap.toAgentConfig(detail);
    const agent = await vicoBootstrap.getRuntime().createAgent(config);

    // 2. 执行 Turn
    const userMessage = { role: 'user' as const, content: message };
    const events = vicoBootstrap.getEvents();
    const signal = c.req.raw.signal;

    // 3. SSE 响应
    const stream = new ReadableStream({
      async start(controller) {
        const handler = (event: unknown) => {
          const sse = `data: ${JSON.stringify(event)}\n\n`;
          controller.enqueue(new TextEncoder().encode(sse));
        };

        events.on('*', handler);

        try {
          await agent.getLoop().runTurn(
            `thread-${agentId}-${Date.now()}`,
            [],
            userMessage,
            signal,
          );
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ type: 'error', message: msg })}\n\n`));
        } finally {
          events.off('*', handler);
          controller.close();
        }
      },
    });

    return c.newResponse(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  });
}
