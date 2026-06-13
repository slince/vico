import { Hono } from 'hono';
import type { Variables } from '../index.js';
import { getAuthContext } from './helpers.js';
import { teamManager } from '../services/team/team-manager.js';

export function teamRoutes(app: Hono<{ Variables: Variables }>) {
  /** GET /api/v1/teams — 团队列表 */
  app.get('/api/v1/teams', async (c) => {
    const auth = await getAuthContext(c);
    if (auth instanceof Response) return auth;
    return c.json(await teamManager.list(auth.tenantId));
  });

  /** POST /api/v1/teams — 创建团队 */
  app.post('/api/v1/teams', async (c) => {
    const auth = await getAuthContext(c);
    if (auth instanceof Response) return auth;
    const team = await teamManager.create(auth.tenantId, await c.req.json());
    return c.json({ id: team.id, message: 'created' });
  });

  /** GET /api/v1/teams/:id — 团队详情 */
  app.get('/api/v1/teams/:id', async (c) => {
    const auth = await getAuthContext(c);
    if (auth instanceof Response) return auth;
    const team = await teamManager.getById(auth.tenantId, c.req.param('id'));
    if (!team) return c.json({ error: 'Team not found' }, 404);
    return c.json(team);
  });

  /** PATCH /api/v1/teams/:id — 更新团队 */
  app.patch('/api/v1/teams/:id', async (c) => {
    const auth = await getAuthContext(c);
    if (auth instanceof Response) return auth;
    try {
      await teamManager.update(auth.tenantId, c.req.param('id'), await c.req.json());
    } catch (e: any) {
      if (e.message === 'Team not found') return c.json({ error: 'Team not found' }, 404);
      throw e;
    }
    return c.json({ message: 'updated' });
  });

  /** DELETE /api/v1/teams/:id — 删除团队 */
  app.delete('/api/v1/teams/:id', async (c) => {
    const auth = await getAuthContext(c);
    if (auth instanceof Response) return auth;
    await teamManager.remove(auth.tenantId, c.req.param('id'));
    return c.json({ message: 'deleted' });
  });

  /** PUT /api/v1/teams/:id/members — 替换团队成员 */
  app.put('/api/v1/teams/:id/members', async (c) => {
    const auth = await getAuthContext(c);
    if (auth instanceof Response) return auth;
    try {
      await teamManager.replaceMembers(auth.tenantId, c.req.param('id'), await c.req.json());
    } catch (e: any) {
      if (e.message === 'Team not found') return c.json({ error: 'Team not found' }, 404);
      throw e;
    }
    return c.json({ message: 'updated' });
  });
}
