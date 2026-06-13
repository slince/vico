import { Hono } from 'hono';
import { v4 as uuidv4 } from 'uuid';
import type { Variables } from '../index.js';
import { getAuthContext } from './helpers.js';
import { createAgent } from '../agent/agent-factory.js';
import { createSSEStream } from '../agent/sse-utils.js';

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
    } catch (error: any) {
      console.error('Chat stream error:', error.message);
      return c.json(
        { error: error?.message || 'An internal error occurred' },
        500,
      );
    }
  });

  /** 团队对话 — 保留现有实现 */
  app.post('/api/v1/teams/:id/chat', async (c) => {
    const auth = await getAuthContext(c);
    if (auth instanceof Response) return auth;
    const teamId = c.req.param('id');
    const body = await c.req.json();
    const { message, conversationId } = body;
    if (!message) return c.json({ error: 'message is required' }, 400);

    // 保留 orchestrator 导入
    const { runTeamPipeline } = await import('../agent/orchestrator.js');
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
