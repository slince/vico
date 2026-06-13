import { Hono } from 'hono';
import type { Variables } from '../index.js';
import { getAuthContext } from './helpers.js';
import { agentManager } from '../services/agent/agent-manager.js';
import { knowledgeManager } from '../services/knowledge/knowledge-manager.js';
import { skillManager } from '../skill/manager.js';

export function dashboardRoutes(app: Hono<{ Variables: Variables }>) {
  app.get('/api/v1/dashboard/stats', async (c) => {
    const auth = await getAuthContext(c);
    if (auth instanceof Response) return auth;

    // TODO: conversations and token_usage_logs tables were removed (Mastra Memory handles).
    const totalConversations = 0;
    const totalTokens = 0;

    const [activeAgents, totalAgents, installedSkills, totalKnowledgeBases] = await Promise.all([
      agentManager.countEnabled(auth.tenantId),
      agentManager.count(auth.tenantId),
      skillManager.countEnabled(auth.tenantId),
      knowledgeManager.count(auth.tenantId),
    ]);

    // TODO: Recent conversations — needs Mastra Memory thread listing
    // TODO: Token usage trend — needs token-tracker processor storage

    return c.json({
      totalConversations,
      totalTokens,
      activeAgents,
      totalAgents,
      installedSkills,
      totalKnowledgeBases,
      recentConversations: [],
      tokenTrend: [],
    });
  });
}
