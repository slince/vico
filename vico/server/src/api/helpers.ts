import type { Context } from 'hono';
import type { Variables } from '../index.js';

/** 管理员角色常量 */
export const ROLE_ADMIN = 'admin';

export interface AuthContext {
  userId: string;
  role: string;
}

/**
 * 从 better-auth session 提取 AuthContext，供路由处理函数使用。
 * 返回 { userId, role }；role 从 session user 读取，缺省为 'user'。
 *
 * @param c Hono 上下文
 * @returns AuthContext，若未认证则返回 401 Response
 */
export async function getAuthContext(c: Context<{ Variables: Variables }>): Promise<AuthContext | Response> {
  const session = c.get('session');
  const user = c.get('user');
  if (!session || !user) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  return {
    userId: user.id,
    role: user.role ?? 'user',
  };
}

/**
 * 管理员门控：先取 auth，非 admin 返回 403。
 * @param c Hono 上下文
 * @returns { userId, role } 或 401/403 Response
 */
export async function requireAdmin(c: Context<{ Variables: Variables }>): Promise<AuthContext | Response> {
  const auth = await getAuthContext(c);
  if (auth instanceof Response) return auth;
  if (auth.role !== ROLE_ADMIN) {
    return c.json({ error: 'Forbidden' }, 403);
  }
  return auth;
}
