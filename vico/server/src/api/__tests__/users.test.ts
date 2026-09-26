import { describe, it, expect } from 'vitest';
import { checkDeleteUser, createUserSchema } from '../users.js';

describe('checkDeleteUser', () => {
  const users = [
    { id: 'admin1', role: 'admin' },
    { id: 'admin2', role: 'admin' },
    { id: 'u1', role: 'user' },
  ];

  it('blocks deleting self', () => {
    const res = checkDeleteUser('admin1', 'admin1', users);
    expect(res.allowed).toBe(false);
    if (!res.allowed) expect(res.status).toBe(403);
  });

  it('blocks deleting the last admin', () => {
    const res = checkDeleteUser('admin1', 'other', [{ id: 'admin1', role: 'admin' }]);
    expect(res.allowed).toBe(false);
    if (!res.allowed) expect(res.error).toContain('管理员');
  });

  it('allows deleting a non-last admin', () => {
    const res = checkDeleteUser('admin1', 'other', users);
    expect(res.allowed).toBe(true);
  });

  it('allows deleting a regular user', () => {
    const res = checkDeleteUser('u1', 'admin1', users);
    expect(res.allowed).toBe(true);
  });
});

describe('createUserSchema', () => {
  it('accepts a valid payload', () => {
    const res = createUserSchema.safeParse({
      username: 'alice', name: 'Alice', email: 'alice@example.com', password: 'password123',
    });
    expect(res.success).toBe(true);
  });

  it('rejects invalid email', () => {
    const res = createUserSchema.safeParse({
      username: 'alice', email: 'not-an-email', password: 'password123',
    });
    expect(res.success).toBe(false);
  });

  it('rejects short password', () => {
    const res = createUserSchema.safeParse({
      username: 'alice', email: 'alice@example.com', password: 'short',
    });
    expect(res.success).toBe(false);
  });

  it('rejects short username', () => {
    const res = createUserSchema.safeParse({
      username: 'a', email: 'alice@example.com', password: 'password123',
    });
    expect(res.success).toBe(false);
  });
});
