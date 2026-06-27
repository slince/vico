import {Hono} from 'hono';
import {cors} from 'hono/cors';
import {eq} from 'drizzle-orm';
import {auth} from './auth';
import {registerRoutes} from './api/router.js';
import {getDb} from './db/db.js';
import {member, session as sessionTable} from './db/auth-schema.js';
import {config} from './config.js';
import logger from './lib/logger.js';
import type {Variables} from './index.js';

/** 创建并配置 Hono app，注册所有中间件和路由 */
export function createApp(): Hono<{ Variables: Variables }> {
  const app = new Hono<{ Variables: Variables }>();

  /** 自定义错误处理 — 返回原始错误信息，方便调试 */
  app.onError((err, c) => {
    logger.error({ err }, 'Unhandled error');
    const message = err instanceof Error ? err.message : 'An internal error occurred';
    const stack = err instanceof Error ? err.stack : undefined;
    return c.json(
      { error: message, stack: config.server.deploy_mode === 'private' ? stack : undefined },
      500,
    );
  });

  /** CORS — 启用 credentials 以支持 session cookie */
  app.use('*', cors({ origin: '*', credentials: true }));

  /** 路径差异化限流（by IP）*/
  const rateMap = new Map<string, { count: number; resetAt: number; limit: number }>();

  // 每 5 分钟清理过期条目
  setInterval(() => {
    const now = Date.now();
    for (const [k, v] of rateMap) {
      if (now > v.resetAt) rateMap.delete(k);
    }
  }, 5 * 60 * 1000);

  /** 根据路径获取限流配额 */
  function getRateLimit(path: string, ip: string): { limit: number } {
    if (path.startsWith('/api/auth/sign-in') || path.startsWith('/api/auth/sign-up')) {
      return { limit: 5 };   // 登录/注册：防暴力破解
    }
    if (path.startsWith('/api/v1/chat')) {
      return { limit: 30 };  // Chat SSE
    }
    return { limit: 100 };   // 默认 CRUD
  }

  app.use('*', async (c, next) => {
    const path = c.req.path;
    // 跳过健康检查和 better-auth 内部路由
    if (path === '/health' || path.startsWith('/api/auth/')) return next();

    const ip = c.req.header('x-forwarded-for') || 'unknown';
    const now = Date.now();
    const { limit } = getRateLimit(path, ip);
    const key = `${ip}:${path.startsWith('/api/auth/sign') ? 'auth' : path.startsWith('/api/v1/chat') ? 'chat' : 'default'}`;

    const entry = rateMap.get(key);
    if (!entry || now > entry.resetAt) {
      rateMap.set(key, { count: 1, resetAt: now + 60000, limit });
      c.res.headers.set('X-RateLimit-Limit', String(limit));
      c.res.headers.set('X-RateLimit-Remaining', String(limit - 1));
      return next();
    }
    if (entry.count >= entry.limit) {
      const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
      c.res.headers.set('Retry-After', String(retryAfter));
      return c.json({ error: 'Too many requests' }, 429);
    }
    entry.count++;
    c.res.headers.set('X-RateLimit-Limit', String(entry.limit));
    c.res.headers.set('X-RateLimit-Remaining', String(entry.limit - entry.count));
    return next();
  });

  /** 健康检查 */
  app.get('/health', (c) => c.json({ status: 'ok' }));

  /** Session 中间件 — 在每个请求上注入 user/session 信息 */
  app.use('*', async (c, next) => {
    // 跳过 better-auth 自身的处理路由和健康检查
    const path = c.req.path;
    if (path === '/health' || path.startsWith('/api/auth/')) {
      return next();
    }

    const result = await auth.api.getSession({
      headers: c.req.raw.headers,
    });

    c.set('user', result?.user ?? null);
    c.set('session', result?.session ?? null);
    return next();
  });

  /** Auth 守卫中间件 — 保护 /api/v1/* 路由，private 模式下自动选择第一个组织 */
  app.use('/api/v1/*', async (c, next) => {
    const session = c.get('session');
    const user = c.get('user');
    if (!session || !user) {
      return c.json({ error: 'Unauthorized' }, 401);
    }
    // 若用户尚未选择活跃组织（private 部署模式下自动选择第一个）
    if (!session.activeOrganizationId) {
      const db = getDb();
      const membership = await db
        .select({ organizationId: member.organizationId })
        .from(member)
        .where(eq(member.userId, user.id))
        .limit(1)
        .get();
      if (!membership) {
        return c.json({ error: 'No organization found' }, 401);
      }
      // 直接更新 session 记录的活跃组织
      await db.update(sessionTable)
        .set({ activeOrganizationId: membership.organizationId })
        .where(eq(sessionTable.id, session.id))
        .run();
      session.activeOrganizationId = membership.organizationId;
    }
    return next();
  });

  /** /api/* 路由的认证保护（跳过 /api/v1/* 和 /api/auth/*） */
  app.use('/api/*', async (c, next) => {
    const path = c.req.path;
    if (path.startsWith('/api/v1/') || path.startsWith('/api/auth/')) {
      return next();
    }
    const session = c.get('session');
    const user = c.get('user');
    if (!session || !user) {
      return c.json({ error: 'Unauthorized' }, 401);
    }
    return next();
  });

  /** 挂载 better-auth 路由处理器 */
  app.on(['POST', 'GET'], '/api/auth/*', (c) => auth.handler(c.req.raw));

  /** 注册业务路由 */
  registerRoutes(app);

  return app;
}
