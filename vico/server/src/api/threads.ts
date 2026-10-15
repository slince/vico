import { Hono } from 'hono';
import type { Variables } from '../index.js';
import {ManualCompactionError, TargetPressureConfigError} from '@vico/core';
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

  /** POST /api/v1/threads/:id/compact — 主动压缩会话历史 */
  app.post('/api/v1/threads/:id/compact', async (c) => {
    const auth = await getAuthContext(c);
    if (auth instanceof Response) return auth;

    const threadId = c.req.param('id');
    const thread = await threadManager.getById(auth.userId, threadId);
    if (!thread) return c.json({ error: 'Thread not found' }, 404);

    const agent = await getAgent(thread.agentId);
    if (!agent.compactor) return c.json({ error: 'Compaction not configured for this agent' }, 501);

    try {
      const result = await agent.compactThread(threadId, c.req.raw.signal);
      if (!result) return c.json({ compacted: false });
      return c.json(result);
    } catch (err) {
      // contextWindow 未配置时主动压缩抛配置错误，映射为 400 而非 500（spec §10）
      if (err instanceof TargetPressureConfigError) {
        return c.json({ error: err.message }, 400);
      }
      if (err instanceof ManualCompactionError) {
        const code = (err as ManualCompactionError).code;
        if (code === 'busy') return c.json({ error: 'Compaction already in progress' }, 409);
        return c.json({ error: err.message }, 400);
      }
      throw err;
    }
  });
}
