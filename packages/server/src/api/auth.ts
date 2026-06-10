import { FastifyInstance } from 'fastify';
import { signToken, verifyPassword, createUser, initDefaultTenant, AuthContext } from '../auth/index.js';
import { getDb } from '../data/db.js';

export function authRoutes(app: FastifyInstance) {
  app.post('/api/v1/auth/login', async (req, reply) => {
    const { username, password } = req.body as any;
    if (!username || !password) {
      return reply.status(400).send({ error: 'Username and password required' });
    }

    const db = getDb();
    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username) as any;
    if (!user || !verifyPassword(password, user.password_hash)) {
      return reply.status(401).send({ error: 'Invalid credentials' });
    }

    const ctx: AuthContext = { userId: user.id, tenantId: user.tenant_id, role: user.role };
    const token = signToken(ctx);
    return { token, user: { id: user.id, username: user.username, role: user.role, tenantId: user.tenant_id } };
  });

  app.post('/api/v1/auth/register', async (req, reply) => {
    const { username, password, role } = req.body as any;
    if (!username || !password) {
      return reply.status(400).send({ error: 'Username and password required' });
    }

    const ctx = req.authContext;
    if (!ctx) return reply.status(401).send({ error: 'Unauthorized' });

    try {
      const userCtx = createUser(ctx.tenantId, username, password, role || 'admin');
      return { userId: userCtx.userId, tenantId: userCtx.tenantId };
    } catch (err: any) {
      return reply.status(400).send({ error: err.message });
    }
  });

  app.get('/api/v1/auth/me', async (req, reply) => {
    const ctx = req.authContext;
    if (!ctx) return reply.status(401).send({ error: 'Unauthorized' });

    const db = getDb();
    const user = db.prepare('SELECT id, username, role, tenant_id FROM users WHERE id = ?').get(ctx.userId) as any;
    if (!user) return reply.status(404).send({ error: 'User not found' });

    return { id: user.id, username: user.username, role: user.role, tenantId: user.tenant_id };
  });
}
