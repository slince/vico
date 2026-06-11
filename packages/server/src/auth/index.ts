import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { v4 as uuid } from 'uuid';
import { eq } from 'drizzle-orm';
import { config } from '../config.js';
import { getDb, schema } from '../data/db.js';

const { tenants, users } = schema;

export interface AuthContext {
  userId: string;
  tenantId: string;
  role: string;
}

export function hashPassword(password: string): string {
  return bcrypt.hashSync(password, 10);
}

export function verifyPassword(password: string, hash: string): boolean {
  return bcrypt.compareSync(password, hash);
}

export function signToken(ctx: AuthContext): string {
  return jwt.sign(ctx, config.auth.jwt_secret, { expiresIn: config.auth.token_expiry as any });
}

export function verifyToken(token: string): AuthContext {
  return jwt.verify(token, config.auth.jwt_secret) as AuthContext;
}

export function initDefaultTenant() {
  const db = getDb();
  const existing = db.select({ id: tenants.id }).from(tenants).limit(1).get();
  if (!existing) {
    const tenantId = uuid();
    const now = Date.now();
    db.insert(tenants).values({
      id: tenantId, name: '默认租户', created_at: now, updated_at: now,
    }).run();
    const adminId = uuid();
    const hash = hashPassword('admin123');
    db.insert(users).values({
      id: adminId, tenant_id: tenantId, username: 'admin', password_hash: hash, role: 'admin', created_at: now,
    }).run();
    console.log('Default tenant and admin user created (admin / admin123)');
  }
}

export function createUser(tenantId: string, username: string, password: string, role = 'admin'): AuthContext {
  const db = getDb();
  const existing = db.select({ id: users.id }).from(users).where(eq(users.username, username)).get();
  if (existing) {
    throw new Error('Username already exists');
  }
  const id = uuid();
  const hash = hashPassword(password);
  db.insert(users).values({
    id, tenant_id: tenantId, username, password_hash: hash, role, created_at: Date.now(),
  }).run();
  return { userId: id, tenantId, role };
}
