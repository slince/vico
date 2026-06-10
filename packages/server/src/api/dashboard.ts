import { FastifyInstance } from 'fastify';
import { getDb } from '../data/db.js';

export function dashboardRoutes(app: FastifyInstance) {
  app.get('/api/v1/dashboard/stats', async (req) => {
    const ctx = req.authContext!;
    const db = getDb();

    const totalConversations = (db.prepare('SELECT COUNT(*) as c FROM conversations WHERE tenant_id = ?').get(ctx.tenantId) as any)?.c || 0;

    const totalTokens = (db.prepare('SELECT COALESCE(SUM(prompt_tokens + completion_tokens), 0) as c FROM token_usage_logs WHERE tenant_id = ?').get(ctx.tenantId) as any)?.c || 0;

    const activeAgents = (db.prepare('SELECT COUNT(*) as c FROM agents WHERE tenant_id = ? AND enabled = 1').get(ctx.tenantId) as any)?.c || 0;

    const totalAgents = (db.prepare('SELECT COUNT(*) as c FROM agents WHERE tenant_id = ?').get(ctx.tenantId) as any)?.c || 0;

    const installedSkills = (db.prepare('SELECT COUNT(*) as c FROM installed_skills WHERE tenant_id = ? AND enabled = 1').get(ctx.tenantId) as any)?.c || 0;

    const totalKnowledgeBases = (db.prepare('SELECT COUNT(*) as c FROM knowledge_bases WHERE tenant_id = ?').get(ctx.tenantId) as any)?.c || 0;

    // Recent conversations
    const recentConversations = db.prepare(
      'SELECT c.*, a.name as agent_name, u.username as user_name FROM conversations c LEFT JOIN agents a ON c.agent_id = a.id LEFT JOIN users u ON c.user_id = u.id WHERE c.tenant_id = ? ORDER BY c.updated_at DESC LIMIT 5'
    ).all(ctx.tenantId);

    // Token usage trend (last 30 days, grouped by day)
    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const tokenTrend = db.prepare(
      `SELECT date(created_at / 1000, 'unixepoch') as day, SUM(prompt_tokens + completion_tokens) as total
       FROM token_usage_logs WHERE tenant_id = ? AND created_at >= ? GROUP BY day ORDER BY day`
    ).all(ctx.tenantId, thirtyDaysAgo);

    return {
      totalConversations,
      totalTokens,
      activeAgents,
      totalAgents,
      installedSkills,
      totalKnowledgeBases,
      recentConversations,
      tokenTrend,
    };
  });
}
