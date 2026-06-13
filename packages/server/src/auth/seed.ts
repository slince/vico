import { randomBytes, scrypt } from 'node:crypto';
import { v4 as uuid } from 'uuid';
import { getDb } from '../db/db.js';
import { user, account, organization, member } from '../db/auth-schema.js';
import logger from '../lib/logger.js';

const scryptConfig = { N: 16384, r: 16, p: 1, dkLen: 64 } as const;

/** 使用与 better-auth 一致的 scrypt 算法生成密码哈希 */
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

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const key = await generateKey(password, salt);
  return `${salt}:${key.toString('hex')}`;
}

/**
 * 首次运行时创建默认组织和管理员用户
 * 管理员凭据：admin / admin123
 */
export async function seedDefaultOrgAndAdmin() {
  const db = getDb();

  // 检查是否已有组织
  const existing = await db.select({ id: organization.id }).from(organization).limit(1).get();
  if (existing) return;

  const now = new Date();
  const orgId = uuid();
  const userId = uuid();
  const accountId = uuid();

  // 创建默认组织（租户）
  await db.insert(organization).values({
    id: orgId,
    name: '默认租户',
    slug: 'default',
    metadata: '{}',
    createdAt: now,
  }).run();

  // 创建管理员用户
  await db.insert(user).values({
    id: userId,
    name: '管理员',
    email: 'admin@vico.local',
    emailVerified: false,
    username: 'admin',
    displayUsername: '管理员',
    createdAt: now,
    updatedAt: now,
  }).run();

  // 使用 better-auth 兼容的 scrypt 哈希创建账户凭证
  const hash = await hashPassword('admin123');
  await db.insert(account).values({
    id: accountId,
    userId,
    accountId: userId,
    providerId: 'credential',
    password: hash,
    createdAt: now,
    updatedAt: now,
  }).run();

  // 将用户加入组织
  await db.insert(member).values({
    id: uuid(),
    organizationId: orgId,
    userId,
    role: 'admin',
    createdAt: now,
  }).run();

  logger.info('Default org and admin created (admin / admin123)');
}
