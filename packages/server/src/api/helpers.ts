import type { Context } from 'hono';
import type { Variables } from '../index.js';

export interface AuthContext {
  tenantId: string;
  userId: string;
}

/**
 * 从 better-auth session 提取 AuthContext，供路由处理函数使用。
 * 保持与旧 JWT 系统相同的 { tenantId, userId } 接口，最小化路由层改动。
 *
 * @param c Hono 上下文
 * @returns AuthContext，若未认证则返回 401 Response
 */
export function getAuthContext(c: Context<{ Variables: Variables }>): AuthContext | Response {
  const session = c.get('session');
  const user = c.get('user');
  if (!session?.activeOrganizationId || !user) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  return {
    tenantId: session.activeOrganizationId,
    userId: user.id,
  };
}
