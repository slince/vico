import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { v4 as uuid } from 'uuid';
import { z } from 'zod';
import type { Variables } from '../index.js';
import { requireAdmin } from './helpers.js';
import { getDb } from '../db/db.js';
import { account, user } from '../db/auth-schema.js';
import { hashPassword } from '../lib/password.js';

/** 新增成员请求体校验 */
export const createUserSchema = z.object({
  username: z.string().min(2, '用户名至少 2 个字符').max(50, '用户名最多 50 个字符'),
  name: z.string().min(1, '姓名不能为空').optional(),
  email: z.string().email('邮箱格式不正确'),
  password: z.string().min(8, '密码至少 8 位'),
});

export type DeleteUserCheck =
  | { allowed: true }
  | { allowed: false; status: 403; error: string };

/**
 * 删除成员守卫（纯函数，便于单测）。
 * 规则：不能删除自己；不能删除最后一个 admin。
 */
export function checkDeleteUser(
  targetId: string,
  currentUserId: string,
  users: Array<{ id: string; role: string }>,
): DeleteUserCheck {
  if (targetId === currentUserId) {
    return { allowed: false, status: 403, error: '不能删除当前登录账号' };
  }
  const target = users.find((u) => u.id === targetId);
  if (!target) return { allowed: true };
  if (target.role === 'admin') {
    const adminCount = users.filter((u) => u.role === 'admin').length;
    if (adminCount <= 1) {
      return { allowed: false, status: 403, error: '不能删除最后一个管理员' };
    }
  }
  return { allowed: true };
}

export function userRoutes(app: Hono<{ Variables: Variables }>) {
  app.get('/api/v1/users', async (c) => {
    const auth = await requireAdmin(c);
    if (auth instanceof Response) return auth;
    const rows = await getDb().select({
      id: user.id,
      username: user.username,
      displayUsername: user.displayUsername,
      name: user.name,
      email: user.email,
      role: user.role,
      createdAt: user.createdAt,
    }).from(user).all();
    return c.json(rows);
  });

  app.post('/api/v1/users', async (c) => {
    const auth = await requireAdmin(c);
    if (auth instanceof Response) return auth;
    const body = await c.req.json();
    const parsed = createUserSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: parsed.error.issues[0]?.message ?? '参数错误' }, 400);
    }
    const { username, name, email, password } = parsed.data;
    const db = getDb();

    const dupUsername = await db.select({ id: user.id }).from(user)
      .where(eq(user.username, username)).get();
    if (dupUsername) return c.json({ error: '用户名已存在' }, 409);
    const dupEmail = await db.select({ id: user.id }).from(user)
      .where(eq(user.email, email)).get();
    if (dupEmail) return c.json({ error: '邮箱已存在' }, 409);

    const now = new Date();
    const userId = uuid();
    await db.insert(user).values({
      id: userId,
      name: name ?? username,
      email,
      emailVerified: false,
      username,
      displayUsername: name ?? username,
      role: 'user',
      createdAt: now,
      updatedAt: now,
    }).run();

    const hash = await hashPassword(password);
    await db.insert(account).values({
      id: uuid(),
      userId,
      accountId: userId,
      providerId: 'credential',
      password: hash,
      createdAt: now,
      updatedAt: now,
    }).run();

    return c.json({ id: userId, username, name: name ?? username, email, role: 'user' }, 201);
  });

  app.delete('/api/v1/users/:id', async (c) => {
    const auth = await requireAdmin(c);
    if (auth instanceof Response) return auth;
    const id = c.req.param('id');
    const db = getDb();
    const users = await db.select({ id: user.id, role: user.role }).from(user).all();
    const check = checkDeleteUser(id, auth.userId, users);
    if (!check.allowed) return c.json({ error: check.error }, check.status);
    // FK onDelete: cascade 已配，删 user 自动清 session/account
    await db.delete(user).where(eq(user.id, id)).run();
    return c.json({ message: 'deleted' });
  });
}
