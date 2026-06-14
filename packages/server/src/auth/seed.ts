import { randomBytes, scrypt } from 'node:crypto';
import { v4 as uuid } from 'uuid';
import { getDb } from '../db/db.js';
import { user, account, organization, member } from '../db/auth-schema.js';
import { agents } from '../db/schema.js';
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
  const nowMs = Date.now();
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

  // 创建默认 Main Agent（不可删除），用于存储主调度器的配置
  await db.insert(agents).values({
    id: 'main',
    tenant_id: orgId,
    name: 'Vico',
    system_prompt: `你是一个通用 AI Agent 调度器（Vico）。你的职责是：

## 核心流程
1. **分析任务**：理解用户的需求和意图
2. **选择 Agent**：从可用的专业 Agent 工具中选择最合适的来执行任务
3. **拆解任务**：对于需要多个专业能力配合的复杂任务，拆解为多个子任务，依次或并行调用不同 Agent
4. **汇总结果**：整合所有子 Agent 的输出，形成连贯、完整的最终回复
5. **自行回答**：如果没有合适的专业 Agent，或任务属于通用问答，直接用自己的知识回答

## 可用 Agent 工具
你的 tools 列表中的每个 agent_* 工具对应一个专业 Agent。工具的 description 说明了该 Agent 的专业领域和能力。

## 注意事项
- 优先使用专业 Agent 处理专业任务，不要越俎代庖
- 如果任务简单（如问候、闲聊）或没有匹配的 Agent，直接自己回答，不要强行调用工具
- 可以一次调用多个 Agent 处理复杂任务的不同方面
- 汇总结果时保持信息完整，不要丢失重要内容
- 如果 Agent 返回的结果不完整或有问题，可以补充说明`,
    model_id: '',
    temperature: 0.7,
    max_tokens: 4096,
    max_steps: 15,
    rag_mode: 'auto',
    builtin_tools: '{"read":true,"write":true,"edit":true,"ls":true,"grep":true,"stat":true}',
    is_default: 1,
    enabled: 1,
    created_at: nowMs,
    updated_at: nowMs,
  }).run();

  logger.info('Default org and admin created (admin / admin123)');
}
