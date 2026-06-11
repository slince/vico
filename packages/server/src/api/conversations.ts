import { Hono } from 'hono';
import { eq, desc, sql, like, and } from 'drizzle-orm';
import type { Variables } from '../index.js';
import { getAuthContext } from './helpers.js';
import { getDb, schema } from '../data/db.js';

const { conversations, messages } = schema;

export function conversationRoutes(app: Hono<{ Variables: Variables }>) {
  app.get('/api/v1/conversations', (c) => {
    const auth = getAuthContext(c);
    if (auth instanceof Response) return auth;
    const db = getDb();
    const agent_id = c.req.query('agent_id');
    const search = c.req.query('search');
    const limit = Number(c.req.query('limit') || '50');
    const offset = Number(c.req.query('offset') || '0');

    const conditions = [eq(conversations.tenant_id, auth.tenantId)];
    if (agent_id) conditions.push(eq(conversations.agent_id, agent_id));
    if (search) conditions.push(like(conversations.title, `%${search}%`));

    const rows = db.select()
      .from(conversations)
      .where(and(...conditions))
      .orderBy(desc(conversations.updated_at))
      .limit(limit)
      .offset(offset)
      .all();

    return c.json(rows);
  });

  app.get('/api/v1/conversations/:id', (c) => {
    const auth = getAuthContext(c);
    if (auth instanceof Response) return auth;
    const id = c.req.param('id');
    const db = getDb();

    const conv = db.select().from(conversations)
      .where(and(eq(conversations.id, id), eq(conversations.tenant_id, auth.tenantId)))
      .get();

    if (!conv) return c.json({ error: 'Not found' }, 404);

    const msgs = db.select().from(messages)
      .where(eq(messages.conversation_id, id))
      .orderBy(sql`created_at ASC`)
      .all();

    return c.json({ ...conv, messages: msgs });
  });

  app.delete('/api/v1/conversations/:id', (c) => {
    const auth = getAuthContext(c);
    if (auth instanceof Response) return auth;
    const id = c.req.param('id');
    const db = getDb();
    db.delete(messages).where(eq(messages.conversation_id, id)).run();
    db.delete(conversations).where(and(eq(conversations.id, id), eq(conversations.tenant_id, auth.tenantId))).run();
    return c.json({ message: 'deleted' });
  });
}
