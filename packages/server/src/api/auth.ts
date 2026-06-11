import { Hono } from 'hono';
import type { Variables } from '../index.js';

/**
 * 受保护的认证路由（在 JWT 中间件之后注册）。
 * better-auth 的 /api/auth/* 端点由 auth.handler() 直接处理。
 */
export function authRoutes(app: Hono<{ Variables: Variables }>) {
  /** 获取当前登录用户信息 */
  app.get('/api/v1/auth/me', (c) => {
    const user = c.get('user');
    const session = c.get('session');
    if (!user) return c.json({ error: 'Not authenticated' }, 401);
    return c.json({
      id: user.id,
      username: (user as any).username ?? user.name,
      role: 'admin',
      tenantId: session?.activeOrganizationId,
    });
  });
}
