import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serve } from '@hono/node-server';
import { eq } from 'drizzle-orm';
import { config } from './config.js';
import { auth } from './auth/index.js';
import { skillManager } from './skill/manager.js';
import { registerRoutes } from './api/router.js';
import { runMigrations } from './db/run-migrations.js';
import { seedDefaultOrgAndAdmin } from './auth/seed.js';
import { getDb } from './db/db.js';
import { member, session as sessionTable } from './db/auth-schema.js';

/** Hono 上下文变量类型 — better-auth session 信息 */
export type Variables = {
  user: typeof auth.$Infer.Session.user | null;
  session: typeof auth.$Infer.Session.session | null;
};

async function main() {
  runMigrations();
  await skillManager.init();
  await seedDefaultOrgAndAdmin();

  const app = new Hono<{ Variables: Variables }>();

  /** CORS — 启用 credentials 以支持 session cookie */
  app.use('*', cors({ origin: '*', credentials: true }));

  /** 简易内存限流（100 次/分钟/IP） */
  const rateMap = new Map<string, { count: number; resetAt: number }>();
  app.use('*', async (c, next) => {
    const ip = c.req.header('x-forwarded-for') || 'unknown';
    const now = Date.now();
    const entry = rateMap.get(ip);
    if (!entry || now > entry.resetAt) {
      rateMap.set(ip, { count: 1, resetAt: now + 60000 });
      return next();
    }
    if (entry.count >= 100) {
      return c.json({ error: 'Too many requests' }, 429);
    }
    entry.count++;
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
    if (!(session as any).activeOrganizationId) {
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
      (session as any).activeOrganizationId = membership.organizationId;
    }
    return next();
  });

  /** 挂载 better-auth 路由处理器 */
  app.on(['POST', 'GET'], '/api/auth/*', (c) => auth.handler(c.req.raw));

  /** 注册业务路由 */
  registerRoutes(app);

  serve({ fetch: app.fetch, port: config.server.port, hostname: '0.0.0.0' }, (info) => {
    console.log(`[Vico] Server running on http://localhost:${info.port}`);
    console.log(`[Vico] Deploy mode: ${config.server.deploy_mode}`);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
