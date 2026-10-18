import {Hono} from 'hono';
import type {Variables} from '../index.js';
import {getAuthContext} from './helpers.js';
import {getContainer} from '../container.js';

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
      getContainer().resolve('agentManager').countEnabled(),
      getContainer().resolve('agentManager').count(),
      getContainer().resolve('knowledgeManager').count(),
      getContainer().resolve('threadManager').count(auth.userId),
      getContainer().resolve('threadManager').recent(auth.userId, 5),
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
