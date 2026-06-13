import { Hono } from 'hono';
import type { Variables } from '../index.js';
import { getAuthContext } from './helpers.js';
import { agentManager } from '../services/agent/agent-manager.js';
import { knowledgeManager } from '../services/knowledge/knowledge-manager.js';
import { skillManager } from '../skill/manager.js';
import { conversationManager } from '../services/conversation/conversation-manager.js';

export function dashboardRoutes(app: Hono<{ Variables: Variables }>) {
  app.get('/api/v1/dashboard/stats', async (c) => {
    const auth = await getAuthContext(c);
    if (auth instanceof Response) return auth;

    // TODO: Token usage trend — needs token-tracker processor storage

    const [
      activeAgents,
      totalAgents,
      installedSkills,
      totalKnowledgeBases,
      totalConversations,
      recentConversations,
    ] = await Promise.all([
      agentManager.countEnabled(auth.tenantId),
      agentManager.count(auth.tenantId),
      skillManager.countEnabled(auth.tenantId),
      knowledgeManager.count(auth.tenantId),
      conversationManager.count(auth.tenantId),
      conversationManager.recent(auth.tenantId, 5),
    ]);

    return c.json({
      totalConversations,
      totalTokens: 0,
      activeAgents,
      totalAgents,
      installedSkills,
      totalKnowledgeBases,
      recentConversations,
      tokenTrend: [],
    });
  });
}
