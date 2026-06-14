/**
 * Exec 审批 API 路由。
 *
 * 提供待审批列表查询和审批处理（批准/拒绝）端点。
 */
import { Hono } from 'hono';
import { eq, and, desc } from 'drizzle-orm';
import type { Variables } from '../index.js';
import { getAuthContext } from './helpers.js';
import { getDb, schema } from '../db/db.js';

export function execApprovalRoutes(app: Hono<{ Variables: Variables }>) {
  /**
   * GET /api/v1/exec-approvals/pending
   * 获取当前租户所有待审批的命令执行请求。
   */
  app.get('/api/v1/exec-approvals/pending', async (c) => {
    const auth = await getAuthContext(c);
    if (auth instanceof Response) return auth;

    const db = getDb();
    const rows = await db.select()
      .from(schema.exec_approvals)
      .where(and(
        eq(schema.exec_approvals.tenant_id, auth.tenantId),
        eq(schema.exec_approvals.status, 'pending'),
      ))
      .orderBy(desc(schema.exec_approvals.created_at))
      .all();

    return c.json(rows);
  });

  /**
   * POST /api/v1/exec-approvals/:id/resolve
   * 批准或拒绝一个待审批命令。Body: { action: "approve" | "reject" }
   */
  app.post('/api/v1/exec-approvals/:id/resolve', async (c) => {
    const auth = await getAuthContext(c);
    if (auth instanceof Response) return auth;

    const approvalId = c.req.param('id');
    const body = await c.req.json();
    const { action } = body;

    if (action !== 'approve' && action !== 'reject') {
      return c.json({ error: 'action must be "approve" or "reject"' }, 400);
    }

    const db = getDb();
    const record = await db.select({ id: schema.exec_approvals.id })
      .from(schema.exec_approvals)
      .where(and(
        eq(schema.exec_approvals.id, approvalId),
        eq(schema.exec_approvals.tenant_id, auth.tenantId),
      ))
      .get();

    if (!record) {
      return c.json({ error: 'Approval not found' }, 404);
    }

    await db.update(schema.exec_approvals)
      .set({
        status: action === 'approve' ? 'approved' : 'rejected',
        resolved_at: Date.now(),
      })
      .where(eq(schema.exec_approvals.id, approvalId))
      .run();

    return c.json({ message: action === 'approve' ? 'approved' : 'rejected' });
  });
}
