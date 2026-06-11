import { Hono } from 'hono';
import { eq, desc, sql, count, sum } from 'drizzle-orm';
import type { Variables } from '../index.js';
import { getDb, schema } from '../data/db.js';

const { conversations, token_usage_logs, agents, installed_skills, knowledge_bases, users } = schema;

export function dashboardRoutes(app: Hono<{ Variables: Variables }>) {
  app.get('/api/v1/dashboard/stats', (c) => {
    const auth = c.get('auth');
    const db = getDb();

    const [convCount] = db.select({ c: count() }).from(conversations)
      .where(eq(conversations.tenant_id, auth.tenantId)).all();
    const totalConversations = convCount?.c ?? 0;

    const [tokenRow] = db.select({ c: sql<number>`COALESCE(SUM(${token_usage_logs.prompt_tokens} + ${token_usage_logs.completion_tokens}), 0)` })
      .from(token_usage_logs).where(eq(token_usage_logs.tenant_id, auth.tenantId)).all();
    const totalTokens = tokenRow?.c ?? 0;

    const [activeAgentRow] = db.select({ c: count() }).from(agents)
      .where(sql`${agents.tenant_id} = ${auth.tenantId} AND ${agents.enabled} = 1`).all();
    const activeAgents = activeAgentRow?.c ?? 0;

    const [totalAgentRow] = db.select({ c: count() }).from(agents)
      .where(eq(agents.tenant_id, auth.tenantId)).all();
    const totalAgents = totalAgentRow?.c ?? 0;

    const [skillRow] = db.select({ c: count() }).from(installed_skills)
      .where(sql`${installed_skills.tenant_id} = ${auth.tenantId} AND ${installed_skills.enabled} = 1`).all();
    const installedSkillsCount = skillRow?.c ?? 0;

    const [kbRow] = db.select({ c: count() }).from(knowledge_bases)
      .where(eq(knowledge_bases.tenant_id, auth.tenantId)).all();
    const totalKnowledgeBases = kbRow?.c ?? 0;

    // Recent conversations with joins
    const recentConversations = db.select({
      id: conversations.id,
      title: conversations.title,
      agent_id: conversations.agent_id,
      user_id: conversations.user_id,
      message_count: conversations.message_count,
      total_tokens: conversations.total_tokens,
      created_at: conversations.created_at,
      updated_at: conversations.updated_at,
      agent_name: agents.name,
      user_name: users.username,
    }).from(conversations)
      .leftJoin(agents, eq(conversations.agent_id, agents.id))
      .leftJoin(users, eq(conversations.user_id, users.id))
      .where(eq(conversations.tenant_id, auth.tenantId))
      .orderBy(desc(conversations.updated_at))
      .limit(5)
      .all();

    // Token usage trend (last 30 days)
    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const tokenTrend = db.select({
      day: sql<string>`date(${token_usage_logs.created_at} / 1000, 'unixepoch')`,
      total: sql<number>`SUM(${token_usage_logs.prompt_tokens} + ${token_usage_logs.completion_tokens})`,
    }).from(token_usage_logs)
      .where(sql`${token_usage_logs.tenant_id} = ${auth.tenantId} AND ${token_usage_logs.created_at} >= ${thirtyDaysAgo}`)
      .groupBy(sql`day`)
      .orderBy(sql`day`)
      .all();

    return c.json({
      totalConversations,
      totalTokens,
      activeAgents,
      totalAgents,
      installedSkills: installedSkillsCount,
      totalKnowledgeBases,
      recentConversations,
      tokenTrend,
    });
  });
}
