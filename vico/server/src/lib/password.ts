import { randomBytes, scrypt } from 'node:crypto';

/** scrypt 参数，与 better-auth credential provider 保持一致 */
const scryptConfig = { N: 16384, r: 16, p: 1, dkLen: 64 } as const;

function generateKey(password: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      password.normalize('NFKC'),
      salt,
      scryptConfig.dkLen,
      { N: scryptConfig.N, r: scryptConfig.r, p: scryptConfig.p, maxmem: 128 * scryptConfig.N * scryptConfig.r * 2 },
      (err, key) => {
        if (err) reject(err);
        else resolve(key);
      },
    );
  });
}

/**
 * 使用与 better-auth 一致的 scrypt 算法生成密码哈希，格式 `salt:hash`（均为 hex）。
 * @param password 明文密码
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const key = await generateKey(password, salt);
  return `${salt}:${key.toString('hex')}`;
}

/**
 * 校验密码是否匹配存储的 `salt:hash`。
 * @param password 待校验明文
 * @param stored 存储的 `salt:hash`
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [salt, expectedHex] = stored.split(':');
  if (!salt || !expectedHex) return false;
  const key = await generateKey(password, salt);
  return key.toString('hex') === expectedHex;
}
