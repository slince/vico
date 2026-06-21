import { describe, it, expect, beforeEach, vi } from 'vitest';

// Reset module state between tests
beforeEach(() => {
  delete process.env.ENCRYPTION_KEY;
  vi.resetModules();
});

describe('encryptApiKey / decryptApiKey', () => {
  it('round-trips with ENCRYPTION_KEY set', async () => {
    process.env.ENCRYPTION_KEY = 'my-secret-key-32-chars-long!!!';
    const { encryptApiKey, decryptApiKey } = await import('../crypto.js');
    const plaintext = 'sk-test-api-key-12345';
    const encrypted = encryptApiKey(plaintext);
    expect(encrypted).not.toBe(plaintext);
    const decrypted = decryptApiKey(encrypted);
    expect(decrypted).toBe(plaintext);
  });

  it('round-trips without ENCRYPTION_KEY (plain base64 fallback)', async () => {
    delete process.env.ENCRYPTION_KEY;
    const { encryptApiKey, decryptApiKey } = await import('../crypto.js');
    const plaintext = 'sk-test-api-key-12345';
    const encoded = encryptApiKey(plaintext);
    expect(encoded).not.toBe(plaintext);
    const decoded = decryptApiKey(encoded);
    expect(decoded).toBe(plaintext);
  });

  it('produces different ciphertext on each call (IV randomization)', async () => {
    process.env.ENCRYPTION_KEY = 'my-secret-key-32-chars-long!!!';
    const { encryptApiKey } = await import('../crypto.js');
    const e1 = encryptApiKey('same-key');
    const e2 = encryptApiKey('same-key');
    expect(e1).not.toBe(e2);
  });
});

describe('maskApiKey', () => {
  it('masks long keys preserving prefix and last 4 chars', async () => {
    const { maskApiKey } = await import('../crypto.js');
    // key >= 20 chars → prefix is 7 chars
    const mask20 = maskApiKey('sk-1234567890abcdefgh');  // 20 chars
    expect(mask20).toBe('sk-1234****efgh');
  });

  it('masks medium keys with 3-char prefix', async () => {
    const { maskApiKey } = await import('../crypto.js');
    // key 9-19 chars → prefix is 3 chars
    const masked = maskApiKey('sk-12345678abcdefgh');  // 19 chars
    expect(masked).toBe('sk-****efgh');
  });

  it('returns **** for very short keys', async () => {
    const { maskApiKey } = await import('../crypto.js');
    expect(maskApiKey('abc')).toBe('****');
  });

  it('handles keys with 8 characters or fewer', async () => {
    const { maskApiKey } = await import('../crypto.js');
    expect(maskApiKey('12345678')).toBe('****');
  });
});
