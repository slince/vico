import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword } from '../password.js';

describe('hashPassword / verifyPassword', () => {
  it('returns salt:hash hex format', async () => {
    const hash = await hashPassword('admin123');
    const [salt, key] = hash.split(':');
    expect(salt).toMatch(/^[0-9a-f]{32}$/);   // 16 bytes salt
    expect(key).toMatch(/^[0-9a-f]{128}$/);  // 64 bytes key
  });

  it('produces a different salt per call', async () => {
    const h1 = await hashPassword('same-password');
    const h2 = await hashPassword('same-password');
    expect(h1.split(':')[0]).not.toBe(h2.split(':')[0]);
  });

  it('verifyPassword returns true for the correct password', async () => {
    const hash = await hashPassword('secret123');
    expect(await verifyPassword('secret123', hash)).toBe(true);
  });

  it('verifyPassword returns false for a wrong password', async () => {
    const hash = await hashPassword('secret123');
    expect(await verifyPassword('wrong', hash)).toBe(false);
  });

  it('verifyPassword returns false for malformed stored value', async () => {
    expect(await verifyPassword('x', 'not-a-valid-hash')).toBe(false);
  });
});
