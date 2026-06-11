import type { Context } from 'hono';
import { eq } from 'drizzle-orm';
import type { Variables } from '../index.js';
import { getDb } from '../data/db.js';
import { member } from '../data/auth-schema.js';

export interface AuthContext {
  tenantId: string;
  userId: string;
}

/**
 * 从 better-auth session 提取 AuthContext，供路由处理函数使用。
 * 保持与旧 JWT 系统相同的 { tenantId, userId } 接口，最小化路由层改动。
 * 若用户尚未选择活跃组织，自动选择第一个所在组织（private 部署模式）。
 *
 * @param c Hono 上下文
 * @returns AuthContext，若未认证则返回 401 Response
 */
export function getAuthContext(c: Context<{ Variables: Variables }>): AuthContext | Response {
  const session = c.get('session');
  const user = c.get('user');
  if (!session || !user) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  // 若活跃组织尚未设置，自动选择用户第一个所在组织
  let orgId = session.activeOrganizationId;
  if (!orgId) {
    const db = getDb();
    const membership = db
      .select({ organizationId: member.organizationId })
      .from(member)
      .where(eq(member.userId, user.id))
      .limit(1)
      .get();
    if (!membership) {
      return c.json({ error: 'No organization found' }, 401);
    }
    orgId = membership.organizationId;
  }
  return {
    tenantId: orgId,
    userId: user.id,
  };
}
