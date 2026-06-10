import { FastifyInstance } from 'fastify';
import { getDb } from '../data/db.js';

export function conversationRoutes(app: FastifyInstance) {
  app.get('/api/v1/conversations', async (req) => {
    const ctx = req.authContext!;
    const db = getDb();
    const { agent_id, search, limit = '50', offset = '0' } = req.query as any;

    let sql = 'SELECT * FROM conversations WHERE tenant_id = ?';
    const params: any[] = [ctx.tenantId];

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

    return db.prepare(sql).all(...params);
  });

  app.get('/api/v1/conversations/:id', async (req, reply) => {
    const ctx = req.authContext!;
    const { id } = req.params as any;
    const db = getDb();

    const conv = db.prepare('SELECT * FROM conversations WHERE id = ? AND tenant_id = ?').get(id, ctx.tenantId);
    if (!conv) return reply.status(404).send({ error: 'Not found' });

    const messages = db.prepare('SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC').all(id);

    return { ...conv as any, messages };
  });

  app.delete('/api/v1/conversations/:id', async (req, reply) => {
    const ctx = req.authContext!;
    const { id } = req.params as any;
    const db = getDb();
    db.prepare('DELETE FROM messages WHERE conversation_id = ?').run(id);
    db.prepare('DELETE FROM conversations WHERE id = ? AND tenant_id = ?').run(id, ctx.tenantId);
    return { message: 'deleted' };
  });
}
