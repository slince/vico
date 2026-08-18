import {Hono} from 'hono';
import type {Variables} from '../index.js';
import {getAuthContext} from './helpers.js';
import {agentManager} from '../services/agent/agent-manager.js';
import {knowledgeManager} from '../services/knowledge/knowledge-manager.js';
import {threadManager} from '../services/thread/thread-manager.js';

export function dashboardRoutes(app: Hono<{ Variables: Variables }>) {
  app.get('/api/v1/dashboard/stats', async (c) => {
    const auth = await getAuthContext(c);
    if (auth instanceof Response) return auth;

    const [
      activeAgents,
      totalAgents,
      totalKnowledgeBases,
      totalThreads,
      recentThreads,
    ] = await Promise.all([
      agentManager.countEnabled(auth.tenantId),
      agentManager.count(auth.tenantId),
      knowledgeManager.count(auth.tenantId),
      threadManager.count(auth.userId),
      threadManager.recent(auth.userId, 5),
    ]);

    return c.json({
      totalThreads,
      totalTokens: 0,
      activeAgents,
      totalAgents,
      totalKnowledgeBases,
      recentThreads,
      tokenTrend: [],
    });
  });
}
