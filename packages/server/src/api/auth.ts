import { Hono } from 'hono';
import type { Variables } from '../index.js';
import { signToken, verifyPassword, createUser, AuthContext } from '../auth/index.js';
import { getDb } from '../data/db.js';

export function authRoutes(app: Hono<{ Variables: Variables }>) {
  app.post('/api/v1/auth/login', async (c) => {
    const { username, password } = await c.req.json();
    if (!username || !password) {
      return c.json({ error: 'Username and password required' }, 400);
    }

    const db = getDb();
    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username) as any;
    if (!user || !verifyPassword(password, user.password_hash)) {
      return c.json({ error: 'Invalid credentials' }, 401);
    }

    const ctx: AuthContext = { userId: user.id, tenantId: user.tenant_id, role: user.role };
    const token = signToken(ctx);
    return c.json({ token, user: { id: user.id, username: user.username, role: user.role, tenantId: user.tenant_id } });
  });

  app.post('/api/v1/auth/register', async (c) => {
    const { username, password, role } = await c.req.json();
    if (!username || !password) {
      return c.json({ error: 'Username and password required' }, 400);
    }

    const auth = c.get('auth');

    try {
      const userCtx = createUser(auth.tenantId, username, password, role || 'admin');
      return c.json({ userId: userCtx.userId, tenantId: userCtx.tenantId });
    } catch (err: any) {
      return c.json({ error: err.message }, 400);
    }
  });

  app.get('/api/v1/auth/me', (c) => {
    const auth = c.get('auth');
    const db = getDb();
    const user = db.prepare('SELECT id, username, role, tenant_id FROM users WHERE id = ?').get(auth.userId) as any;
    if (!user) return c.json({ error: 'User not found' }, 404);

    return c.json({ id: user.id, username: user.username, role: user.role, tenantId: user.tenant_id });
  });
}
