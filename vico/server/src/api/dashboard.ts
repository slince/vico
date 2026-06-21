import { Hono } from 'hono';
import type { Variables } from '../index.js';
import { getAuthContext } from './helpers.js';
import { agentManager } from '../services/agent/agent-manager.js';
import { knowledgeManager } from '../services/knowledge/knowledge-manager.js';
import { conversationManager } from '../services/conversation/conversation-manager.js';

export function dashboardRoutes(app: Hono<{ Variables: Variables }>) {
  app.get('/api/v1/dashboard/stats', async (c) => {
    const auth = await getAuthContext(c);
    if (auth instanceof Response) return auth;

    // TODO: Token usage trend — needs token-tracker processor storage

    const [
      activeAgents,
      totalAgents,
      totalKnowledgeBases,
      totalConversations,
      recentConversations,
    ] = await Promise.all([
      agentManager.countEnabled(auth.tenantId),
      agentManager.count(auth.tenantId),
      knowledgeManager.count(auth.tenantId),
      conversationManager.count(auth.userId),
      conversationManager.recent(auth.userId, 5),
    ]);

    return c.json({
      totalConversations,
      totalTokens: 0,
      activeAgents,
      totalAgents,
      totalKnowledgeBases,
      recentConversations,
      tokenTrend: [],
    });
  });
}
