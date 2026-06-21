/**
 * API Key 加解密工具 — AES-256-GCM
 *
 * 使用环境变量 ENCRYPTION_KEY 作为加密密钥。
 * 若未设置，回退到明文存储（私有部署可接受）。
 */
import crypto from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

function getKey(): Buffer | null {
  const key = process.env.ENCRYPTION_KEY;
  if (!key) return null;
  return crypto.createHash('sha256').update(key).digest();
}

/**
 * 加密 API Key。
 * 若 ENCRYPTION_KEY 未设置，返回明文（base64 编码以区分未加密状态）。
 * 加密输出格式: base64(iv + authTag + ciphertext)
 */
export function encryptApiKey(plaintext: string): string {
  const key = getKey();
  if (!key) return Buffer.from(plaintext, 'utf-8').toString('base64');

  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf-8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, encrypted]).toString('base64');
}

/**
 * 解密 API Key。
 * 若 ENCRYPTION_KEY 未设置，回退到 base64 解码。
 */
export function decryptApiKey(encoded: string): string {
  const key = getKey();
  const buf = Buffer.from(encoded, 'base64');
  if (!key) return buf.toString('utf-8');

  const iv = buf.subarray(0, IV_LENGTH);
  const authTag = buf.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const ciphertext = buf.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf-8');
}

/**
 * 将 API Key 掩码化，仅显示前缀和末尾 4 个字符。
 * e.g. "sk-1234abcd5678efgh" → "sk-****efgh"
 */
export function maskApiKey(apiKey: string): string {
  if (apiKey.length <= 8) return '****';
  const prefix = apiKey.length >= 20 ? apiKey.slice(0, 7) : apiKey.slice(0, 3);
  return `${prefix}****${apiKey.slice(-4)}`;
}
