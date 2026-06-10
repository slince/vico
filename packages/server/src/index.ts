import Fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { config } from './config.js';
import { verifyToken, initDefaultTenant } from './auth/index.js';
import { skillManager } from './skill/manager.js';
import { registerRoutes } from './api/router.js';
import { runMigrations } from './data/run-migrations.js';

declare module 'fastify' {
  interface FastifyRequest {
    authContext?: {
      userId: string;
      tenantId: string;
      role: string;
    };
  }
}

async function main() {
  // Run migrations
  runMigrations();

  // Initialize skill manager
  await skillManager.init();

  // Initialize default tenant
  initDefaultTenant();

  const app = Fastify({ logger: true });

  // Plugins
  await app.register(cors, { origin: true, credentials: true });
  await app.register(rateLimit, { max: 100, timeWindow: '1 minute' });

  // Auth middleware (skip for login/register)
  app.addHook('onRequest', async (req, reply) => {
    const publicPaths = [
      '/api/v1/auth/login',
      '/api/v1/auth/register',
    ];

    if (publicPaths.includes(req.url)) {
      return;
    }

    // Skip auth for GET requests to health check
    if (req.url === '/health') return;

    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return reply.status(401).send({ error: 'Missing authorization header' });
    }

    try {
      const token = authHeader.slice(7);
      const ctx = verifyToken(token);
      req.authContext = ctx;
    } catch {
      return reply.status(401).send({ error: 'Invalid token' });
    }
  });

  // Health check
  app.get('/health', async () => ({ status: 'ok' }));

  // Register API routes
  registerRoutes(app);

  // Start server
  try {
    await app.listen({ port: config.server.port, host: '0.0.0.0' });
    console.log(`[Vico] Server running on http://localhost:${config.server.port}`);
    console.log(`[Vico] Deploy mode: ${config.server.deploy_mode}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

main();
