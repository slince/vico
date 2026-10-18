import {Hono} from 'hono';
import type {Variables} from '../index.js';
import {getAuthContext} from './helpers.js';
import {getContainer} from '../container.js';

export function dashboardRoutes(app: Hono<{ Variables: Variables }>) {
  app.get('/api/v1/dashboard/stats', async (c) => {
    const auth = await getAuthContext(c);
    if (auth instanceof Response) return auth;

    const agentManager = getContainer().resolve('agentManager');
    const knowledgeManager = getContainer().resolve('knowledgeManager');
    const threadManager = getContainer().resolve('threadManager');

    const [
      activeAgents,
      totalAgents,
      totalKnowledgeBases,
      totalThreads,
      recentThreads,
    ] = await Promise.all([
      agentManager.countEnabled(),
      agentManager.count(),
      knowledgeManager.count(),
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
