import { Hono } from 'hono';
import { eq, and, desc, like, or } from 'drizzle-orm';
import type { Variables } from '../index.js';
import { getAuthContext } from './helpers.js';
import { getDb, schema } from '../db/db.js';

const { conversations, messages, agents } = schema;

export function conversationRoutes(app: Hono<{ Variables: Variables }>) {
  /** 对话列表 — 支持搜索和按 Agent 过滤 */
  app.get('/api/v1/conversations', async (c) => {
    const auth = await getAuthContext(c);
    if (auth instanceof Response) return auth;

    const db = getDb();
    const search = c.req.query('search');
    const agentId = c.req.query('agent_id');

    const conditions = [eq(conversations.tenant_id, auth.tenantId)];

    if (agentId) {
      conditions.push(eq(conversations.agent_id, agentId));
    }

    let query = db.select().from(conversations)
      .where(and(...conditions))
      .orderBy(desc(conversations.updated_at));

    const rows = await query.all();

    // 补充 agent name
    const result = [];
    for (const conv of rows) {
      let agentName: string | undefined;
      if (conv.agent_id) {
        const agent = await db.select({ name: agents.name })
          .from(agents)
          .where(eq(agents.id, conv.agent_id))
          .get();
        agentName = agent?.name;
      }
      result.push({ ...conv, agent_name: agentName });
    }

    // 搜索过滤在内存中做（简单全文搜索）
    if (search) {
      const term = search.toLowerCase();
      return c.json(result.filter((conv) =>
        conv.title.toLowerCase().includes(term) ||
        (conv.agent_name || '').toLowerCase().includes(term)
      ));
    }

    return c.json(result);
  });

  /** 对话详情 — 包含消息列表 */
  app.get('/api/v1/conversations/:id', async (c) => {
    const auth = await getAuthContext(c);
    if (auth instanceof Response) return auth;

    const id = c.req.param('id');
    const db = getDb();

    const conversation = await db.select().from(conversations)
      .where(and(eq(conversations.id, id), eq(conversations.tenant_id, auth.tenantId)))
      .get();

    if (!conversation) return c.json({ error: 'Conversation not found' }, 404);

    // 获取消息列表
    const messageRows = await db.select().from(messages)
      .where(eq(messages.conversation_id, id))
      .orderBy(messages.created_at)
      .all();

    // 补充 agent name
    let agentName: string | undefined;
    if (conversation.agent_id) {
      const agent = await db.select({ name: agents.name })
        .from(agents)
        .where(eq(agents.id, conversation.agent_id))
        .get();
      agentName = agent?.name;
    }

    return c.json({
      ...conversation,
      agent_name: agentName,
      messages: messageRows,
    });
  });
}
