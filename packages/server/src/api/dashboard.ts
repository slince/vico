import { Hono } from 'hono';
import { eq, sql, count } from 'drizzle-orm';
import type { Variables } from '../index.js';
import { getAuthContext } from './helpers.js';
import { getDb, schema } from '../db/db.js';

const { agents, installed_skills, knowledge_bases } = schema;

export function dashboardRoutes(app: Hono<{ Variables: Variables }>) {
  app.get('/api/v1/dashboard/stats', async (c) => {
    const auth = await getAuthContext(c);
    if (auth instanceof Response) return auth;
    const db = getDb();

    // TODO: conversations and token_usage_logs tables were removed (Mastra Memory handles).
    // These stats will return zeros until Mastra Memory equivalents are implemented.

    // Total conversations — removed with conversations table
    const totalConversations = 0;

    // Token usage — removed with token_usage_logs table (now handled by token-tracker processor)
    const totalTokens = 0;

    const [activeAgentRow] = await db.select({ c: count() }).from(agents)
      .where(sql`${agents.tenant_id} = ${auth.tenantId} AND ${agents.enabled} = 1`).all();
    const activeAgents = activeAgentRow?.c ?? 0;

    const [totalAgentRow] = await db.select({ c: count() }).from(agents)
      .where(eq(agents.tenant_id, auth.tenantId)).all();
    const totalAgents = totalAgentRow?.c ?? 0;

    const [skillRow] = await db.select({ c: count() }).from(installed_skills)
      .where(sql`${installed_skills.tenant_id} = ${auth.tenantId} AND ${installed_skills.enabled} = 1`).all();
    const installedSkillsCount = skillRow?.c ?? 0;

    const [kbRow] = await db.select({ c: count() }).from(knowledge_bases)
      .where(eq(knowledge_bases.tenant_id, auth.tenantId)).all();
    const totalKnowledgeBases = kbRow?.c ?? 0;

    // TODO: Recent conversations — needs Mastra Memory thread listing
    const recentConversations: any[] = [];

    // TODO: Token usage trend — needs token-tracker processor storage
    const tokenTrend: any[] = [];

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
