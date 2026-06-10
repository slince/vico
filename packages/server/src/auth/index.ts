import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { v4 as uuid } from 'uuid';
import { config } from '../config.js';
import { getDb } from '../data/db.js';

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
  const existing = db.prepare('SELECT id FROM tenants LIMIT 1').get();
  if (!existing) {
    const tenantId = uuid();
    const now = Date.now();
    db.prepare('INSERT INTO tenants (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)').run(
      tenantId, '默认租户', now, now
    );
    const adminId = uuid();
    const hash = hashPassword('admin123');
    db.prepare('INSERT INTO users (id, tenant_id, username, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
      adminId, tenantId, 'admin', hash, 'admin', now
    );
    console.log('Default tenant and admin user created (admin / admin123)');
  }
}

export function createUser(tenantId: string, username: string, password: string, role = 'admin'): AuthContext {
  const db = getDb();
  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username) as any;
  if (existing) {
    throw new Error('Username already exists');
  }
  const id = uuid();
  const hash = hashPassword(password);
  db.prepare('INSERT INTO users (id, tenant_id, username, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
    id, tenantId, username, hash, role, Date.now()
  );
  return { userId: id, tenantId, role };
}
