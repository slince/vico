import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serve } from '@hono/node-server';
import { config } from './config.js';
import { verifyToken, initDefaultTenant, AuthContext } from './auth/index.js';
import { skillManager } from './skill/manager.js';
import { registerRoutes } from './api/router.js';
import { runMigrations } from './data/run-migrations.js';

export type Variables = {
  auth: AuthContext;
};

async function main() {
  // Run migrations
  runMigrations();

  // Initialize skill manager
  await skillManager.init();

  // Initialize default tenant
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

  // Auth middleware (skip for login/register/health)
  app.use('*', async (c, next) => {
    const publicPaths = ['/api/v1/auth/login', '/api/v1/auth/register'];
    const path = c.req.path;

    if (publicPaths.includes(path) || path === '/health') {
      return next();
    }

    const authHeader = c.req.header('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return c.json({ error: 'Missing authorization header' }, 401);
    }

    try {
      const token = authHeader.slice(7);
      const ctx = verifyToken(token);
      c.set('auth', ctx);
      return next();
    } catch {
      return c.json({ error: 'Invalid token' }, 401);
    }
  });

  // Health check
  app.get('/health', (c) => c.json({ status: 'ok' }));

  // Register API routes
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
