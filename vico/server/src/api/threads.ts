import { Hono } from 'hono';
import type { Variables } from '../index.js';
import { getAuthContext } from './helpers.js';
import { threadManager } from '../services/thread/thread-manager.js';
import { getAgent } from '../agent/get-agent.js';

export function threadRoutes(app: Hono<{ Variables: Variables }>) {
  /** POST /api/v1/threads — 创建会话（新会话提交消息前调用，提前拿到真实 thread id） */
  app.post('/api/v1/threads', async (c) => {
    const auth = await getAuthContext(c);
    if (auth instanceof Response) return auth;

    const body = await c.req.json();
    const agentId = body.agentId as string;
    if (!agentId) {
      return c.json({ error: 'agentId is required' }, 400);
    }

    const agent = await getAgent(agentId);
    const thread = await agent.createThread({ userId: auth.userId });
    return c.json(thread, 201);
  });

  /** GET /api/v1/threads — 线程列表 */
  app.get('/api/v1/threads', async (c) => {
    const auth = await getAuthContext(c);
    if (auth instanceof Response) return auth;
    const filters = {
      search: c.req.query('search')?.toLowerCase(),
      agent_id: c.req.query('agent_id'),
    };
    return c.json(await threadManager.list(auth.userId, filters));
  });

  /** GET /api/v1/threads/:id — 线程详情（含消息，支持分页） */
  app.get('/api/v1/threads/:id', async (c) => {
    const auth = await getAuthContext(c);
    if (auth instanceof Response) return auth;
    const rawLimit = c.req.query('limit');
    const rawStart = c.req.query('start');
    const limit = rawLimit ? parseInt(rawLimit, 10) : undefined;
    const start = rawStart ? parseInt(rawStart, 10) : undefined;
    const thread = await threadManager.getById(auth.userId, c.req.param('id'), { limit, start });
    if (!thread) return c.json({ error: 'Thread not found' }, 404);
    return c.json(thread);
  });

  /** DELETE /api/v1/threads/:id — 删除线程 */
  app.delete('/api/v1/threads/:id', async (c) => {
    const auth = await getAuthContext(c);
    if (auth instanceof Response) return auth;
    const deleted = await threadManager.delete(auth.userId, c.req.param('id'));
    if (!deleted) return c.json({ error: 'Thread not found' }, 404);
    return c.json({ success: true });
  });
}
