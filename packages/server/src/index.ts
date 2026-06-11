import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { jwt } from 'hono/jwt';
import { serve } from '@hono/node-server';
import { config } from './config.js';
import { initDefaultTenant, AuthContext } from './auth/index.js';
import { skillManager } from './skill/manager.js';
import { registerRoutes } from './api/router.js';
import { publicAuthRoutes } from './api/auth.js';
import { runMigrations } from './data/run-migrations.js';

export type Variables = {
  auth: AuthContext;
};

async function main() {
  runMigrations();
  await skillManager.init();
  initDefaultTenant();

  const app = new Hono<{ Variables: Variables }>();

  // CORS
  app.use('*', cors({ origin: '*', credentials: true }));

  // Simple in-memory rate limiter (100 requests per minute per IP)
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

  // Health check (no auth)
  app.get('/health', (c) => c.json({ status: 'ok' }));

  // Public auth routes (login, register — no JWT required)
  publicAuthRoutes(app);

  // JWT middleware — protects all /api/v1/* routes below this point
  app.use('/api/v1/*', jwt({ secret: config.auth.jwt_secret, alg: 'HS256' }));

  // Copy JWT payload to our custom auth variable
  app.use('/api/v1/*', async (c, next) => {
    const payload = c.get('jwtPayload');
    c.set('auth', { userId: payload.userId, tenantId: payload.tenantId, role: payload.role } as AuthContext);
    await next();
  });

  // Protected routes
  registerRoutes(app);

  // Start server
  serve({ fetch: app.fetch, port: config.server.port, hostname: '0.0.0.0' }, (info) => {
    console.log(`[Vico] Server running on http://localhost:${info.port}`);
    console.log(`[Vico] Deploy mode: ${config.server.deploy_mode}`);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
