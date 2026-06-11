import { Hono } from 'hono';
import type { Variables } from '../index.js';
import { getDb } from '../data/db.js';

export function conversationRoutes(app: Hono<{ Variables: Variables }>) {
  app.get('/api/v1/conversations', (c) => {
    const auth = c.get('auth');
    const db = getDb();
    const agent_id = c.req.query('agent_id');
    const search = c.req.query('search');
    const limit = c.req.query('limit') || '50';
    const offset = c.req.query('offset') || '0';

    let sql = 'SELECT * FROM conversations WHERE tenant_id = ?';
    const params: any[] = [auth.tenantId];

    if (agent_id) {
      sql += ' AND agent_id = ?';
      params.push(agent_id);
    }
    if (search) {
      sql += ' AND title LIKE ?';
      params.push(`%${search}%`);
    }

    sql += ' ORDER BY updated_at DESC LIMIT ? OFFSET ?';
    params.push(Number(limit), Number(offset));

    return c.json(db.prepare(sql).all(...params));
  });

  app.get('/api/v1/conversations/:id', (c) => {
    const auth = c.get('auth');
    const id = c.req.param('id');
    const db = getDb();

    const conv = db.prepare('SELECT * FROM conversations WHERE id = ? AND tenant_id = ?').get(id, auth.tenantId);
    if (!conv) return c.json({ error: 'Not found' }, 404);

    const messages = db.prepare('SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC').all(id);

    return c.json({ ...conv as any, messages });
  });

  app.delete('/api/v1/conversations/:id', (c) => {
    const auth = c.get('auth');
    const id = c.req.param('id');
    const db = getDb();
    db.prepare('DELETE FROM messages WHERE conversation_id = ?').run(id);
    db.prepare('DELETE FROM conversations WHERE id = ? AND tenant_id = ?').run(id, auth.tenantId);
    return c.json({ message: 'deleted' });
  });
}
