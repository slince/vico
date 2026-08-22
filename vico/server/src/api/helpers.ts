import type { Context } from 'hono';
import type { Variables } from '../index.js';

export interface AuthContext {
  userId: string;
}

/**
 * 从 better-auth session 提取 AuthContext，供路由处理函数使用。
 * 仅返回 { userId }。
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
  };
}
