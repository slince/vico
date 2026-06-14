import {Hono} from 'hono';
import type {Variables} from '../index.js';
import {getAuthContext} from './helpers.js';
import {agentManager} from '../services/agent/agent-manager.js';

export function agentRoutes(app: Hono<{ Variables: Variables }>) {
  // ── 列表 ──
  app.get('/api/v1/agents', async (c) => {
    const auth = await getAuthContext(c);
    if (auth instanceof Response) return auth;
    return c.json(await agentManager.list(auth.tenantId));
  });

  // ── 创建 ──
  app.post('/api/v1/agents', async (c) => {
    const auth = await getAuthContext(c);
    if (auth instanceof Response) return auth;
    const agent = await agentManager.create(auth.tenantId, await c.req.json());
    return c.json({ id: agent.id, message: 'created' });
  });

  // ── 详情 ──
  app.get('/api/v1/agents/:id', async (c) => {
    const auth = await getAuthContext(c);
    if (auth instanceof Response) return auth;
    const agent = await agentManager.getById(auth.tenantId, c.req.param('id'));
    if (!agent) return c.json({ error: 'Agent not found' }, 404);
    return c.json(agent);
  });

  // ── 更新 ──
  app.patch('/api/v1/agents/:id', async (c) => {
    const auth = await getAuthContext(c);
    if (auth instanceof Response) return auth;
    try {
      await agentManager.update(auth.tenantId, c.req.param('id'), await c.req.json());
    } catch (e: any) {
      if (e.message === 'Agent not found') return c.json({ error: 'Agent not found' }, 404);
      if (e.message === 'Cannot modify system prompt of the default agent') return c.json({ error: e.message }, 403);
      if (e.message === 'Cannot disable the default agent') return c.json({ error: e.message }, 403);
      throw e;
    }
    return c.json({ message: 'updated' });
  });

  // ── 删除 ──
  app.delete('/api/v1/agents/:id', async (c) => {
    const auth = await getAuthContext(c);
    if (auth instanceof Response) return auth;
    try {
      await agentManager.remove(auth.tenantId, c.req.param('id'));
    } catch (e: any) {
      if (e.message === 'Cannot delete the default agent') {
        return c.json({ error: e.message }, 403);
      }
      throw e;
    }
    return c.json({ message: 'deleted' });
  });

  // ── 替换 Skills ──
  app.put('/api/v1/agents/:id/skills', async (c) => {
    const auth = await getAuthContext(c);
    if (auth instanceof Response) return auth;
    await agentManager.replaceSkills(auth.tenantId, c.req.param('id'), await c.req.json());
    return c.json({ message: 'updated' });
  });

  // ── 替换知识库 ──
  app.put('/api/v1/agents/:id/knowledge', async (c) => {
    const auth = await getAuthContext(c);
    if (auth instanceof Response) return auth;
    await agentManager.replaceKnowledge(auth.tenantId, c.req.param('id'), await c.req.json());
    return c.json({ message: 'updated' });
  });
}
