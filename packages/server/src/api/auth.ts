import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { sign, verify } from 'hono/jwt';
import type { Variables } from '../index.js';
import { verifyPassword, createUser, AuthContext } from '../auth/index.js';
import { getDb, schema } from '../data/db.js';
import { config } from '../config.js';

const { users } = schema;

/** Public routes — registered before JWT middleware, no enforced auth. */
export function publicAuthRoutes(app: Hono<{ Variables: Variables }>) {
  app.post('/api/v1/auth/login', async (c) => {
    const { username, password } = await c.req.json();
    if (!username || !password) {
      return c.json({ error: 'Username and password required' }, 400);
    }

    const db = getDb();
    const user = db.select().from(users).where(eq(users.username, username)).get();
    if (!user || !verifyPassword(password, user.password_hash)) {
      return c.json({ error: 'Invalid credentials' }, 401);
    }

    const ctx: AuthContext = { userId: user.id, tenantId: user.tenant_id, role: user.role };
    const token = await sign(ctx, config.auth.jwt_secret);
    return c.json({ token, user: { id: user.id, username: user.username, role: user.role, tenantId: user.tenant_id } });
  });

  app.post('/api/v1/auth/register', async (c) => {
    const { username, password, role } = await c.req.json();
    if (!username || !password) {
      return c.json({ error: 'Username and password required' }, 400);
    }

    // Register requires caller auth; verify token manually since this is before JWT middleware
    const authHeader = c.req.header('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    try {
      const payload = await verify(authHeader.slice(7), config.auth.jwt_secret);
      const ctx = payload as AuthContext;

      try {
        const userCtx = createUser(ctx.tenantId, username, password, role || 'admin');
        return c.json({ userId: userCtx.userId, tenantId: userCtx.tenantId });
      } catch (err: any) {
        return c.json({ error: err.message }, 400);
      }
    } catch {
      return c.json({ error: 'Invalid token' }, 401);
    }
  });
}

/** Protected routes — registered after JWT middleware. */
export function authRoutes(app: Hono<{ Variables: Variables }>) {
  app.get('/api/v1/auth/me', (c) => {
    const auth = c.get('auth');
    const db = getDb();
    const user = db.select({
      id: users.id,
      username: users.username,
      role: users.role,
      tenant_id: users.tenant_id,
    }).from(users).where(eq(users.id, auth.userId)).get();

    if (!user) return c.json({ error: 'User not found' }, 404);

    return c.json({ id: user.id, username: user.username, role: user.role, tenantId: user.tenant_id });
  });
}
