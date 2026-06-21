import { Hono } from 'hono';
import type { Variables } from '../index.js';
import { getAuthContext } from './helpers.js';
import { conversationManager } from '../services/conversation/conversation-manager.js';

export function conversationRoutes(app: Hono<{ Variables: Variables }>) {
  /** GET /api/v1/conversations — 对话列表 */
  app.get('/api/v1/conversations', async (c) => {
    const auth = await getAuthContext(c);
    if (auth instanceof Response) return auth;
    const filters = {
      search: c.req.query('search')?.toLowerCase(),
      agent_id: c.req.query('agent_id'),
    };
    return c.json(await conversationManager.list(auth.userId, filters));
  });

  /** GET /api/v1/conversations/:id — 对话详情（含消息） */
  app.get('/api/v1/conversations/:id', async (c) => {
    const auth = await getAuthContext(c);
    if (auth instanceof Response) return auth;
    const conv = await conversationManager.getById(auth.userId, c.req.param('id'));
    if (!conv) return c.json({ error: 'Conversation not found' }, 404);
    return c.json(conv);
  });

  /** DELETE /api/v1/conversations/:id — 删除对话 */
  app.delete('/api/v1/conversations/:id', async (c) => {
    const auth = await getAuthContext(c);
    if (auth instanceof Response) return auth;
    const deleted = await conversationManager.delete(auth.userId, c.req.param('id'));
    if (!deleted) return c.json({ error: 'Conversation not found' }, 404);
    return c.json({ success: true });
  });
}
