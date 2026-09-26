import { describe, it, expect } from 'vitest';
import type { Context } from 'hono';
import type { Variables } from '../../index.js';
import { getAuthContext, requireAdmin, ROLE_ADMIN } from '../helpers.js';

function mockContext(user: { id: string; role?: string } | null, session: unknown = {}) {
  return {
    get(key: string) {
      if (key === 'user') return user;
      if (key === 'session') return session;
      return undefined;
    },
    json(body: unknown, status: number) {
      return new Response(JSON.stringify(body), { status });
    },
  } as unknown as Context<{ Variables: Variables }>;
}

describe('getAuthContext', () => {
  it('returns userId and role for an authenticated user', async () => {
    const res = await getAuthContext(mockContext({ id: 'u1', role: 'admin' }));
    expect(res).toEqual({ userId: 'u1', role: 'admin' });
  });

  it('defaults role to "user" when absent', async () => {
    const res = await getAuthContext(mockContext({ id: 'u1' }));
    expect(res).toEqual({ userId: 'u1', role: 'user' });
  });

  it('returns 401 when unauthenticated', async () => {
    const res = await getAuthContext(mockContext(null));
    expect(res).toBeInstanceOf(Response);
    expect((res as Response).status).toBe(401);
  });
});

describe('requireAdmin', () => {
  it('allows admin role', async () => {
    const res = await requireAdmin(mockContext({ id: 'u1', role: 'admin' }));
    expect(res).toEqual({ userId: 'u1', role: 'admin' });
  });

  it('rejects non-admin role with 403', async () => {
    const res = await requireAdmin(mockContext({ id: 'u2', role: 'user' }));
    expect(res).toBeInstanceOf(Response);
    expect((res as Response).status).toBe(403);
  });

  it('rejects missing role with 403', async () => {
    const res = await requireAdmin(mockContext({ id: 'u2' }));
    expect(res).toBeInstanceOf(Response);
    expect((res as Response).status).toBe(403);
  });

  it('rejects unauthenticated with 401', async () => {
    const res = await requireAdmin(mockContext(null));
    expect(res).toBeInstanceOf(Response);
    expect((res as Response).status).toBe(401);
  });

  it('exports ROLE_ADMIN constant', () => {
    expect(ROLE_ADMIN).toBe('admin');
  });
});
