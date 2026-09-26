# 配置模块 UI 升级 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 Settings 页升级为「左侧分组导航 + 右侧内容」壳，落地三个 section（常规设置 / 用户管理 / 模型管理），并引入 `admin`/`user` 两态角色权限。

**Architecture:** 后端在 better-auth `user` 表加 `role` 列（迁移 + backfill），新增 `requireAdmin` 门控 helper 与 `api/users.ts`；前端新增 ThemeProvider，重写 Settings 为分组导航壳，把现有模型 CRUD 迁入 `ModelManagement`，新增 `UserManagement` + `AddUserDialog`。角色经 better-auth `getSession()` 自然流到前端 `useAuth().user.role`。

**Tech Stack:** Hono 4 + better-auth + Drizzle ORM (libsql) + Zod 4 + Vitest（后端）；React 19 + Vite 6 + Tailwind 4 + shadcn/ui + TanStack Query 5 + react-i18next（前端）。

**Spec:** [docs/superpowers/specs/2026-09-25-config-module-ui-upgrade-design.md](../specs/2026-09-25-config-module-ui-upgrade-design.md)

## Global Constraints

- 后端 ESM，相对导入必须带 `.js` 扩展名；`import type` 用于仅类型导入。
- 路由层每个 handler 第一行取 auth（`getAuthContext`/`requireAdmin`），不做业务逻辑，不写 try-catch；异常自然冒泡。
- better-auth 表主键用 `uuid()`，`createdAt`/`updatedAt` 传 `new Date()`（timestamp mode）。
- 避免 `any`（测试 mock 里 `as unknown as Context<...>` 是唯一例外）。
- 前端导入顺序：React → 第三方 → API/Hooks → UI 组件 → 页面子组件 → 类型。
- 弹窗/表单 >60 行必拆独立文件；数据驱动组件必须覆盖 加载(Skeleton)/空(Empty)/错误/正常 四态。
- 迁移必须同步更新 `drizzle/meta/_journal.json`；`migrate()` 需 `await`。
- `role` 列 `default 'user'`；仅 seed 管理员为 `'admin'`；新成员固定 `'user'`。
- 主题两态 `light`/`dark`，默认 `light`，localStorage 持久化 `theme`；语言沿用 `i18n.changeLanguage()` + languagedetector。

## Review Focus

1. 非 admin（`role='user'`）调 `POST/PATCH/DELETE /api/v1/models` 或任意 `/api/v1/users` 端点 → 必须 403，不能静默成功或 500。→ Task 3 的 `requireAdmin` 测试 + Task 4/6 接线。
2. 新增用户时 username/email 重复 → 返回 409 与明确文案，不能抛裸 SQLite UNIQUE 错误。→ Task 4 手动验证步骤（需 DB）。
3. 新增用户时 email 非法或 password 少于 8 位 → 400 拦截，不落库。→ Task 4 的 `createUserSchema` 测试。
4. 删除自己 / 删除最后一个 admin → 403，系统不能锁死。→ Task 4 的 `checkDeleteUser` 测试。
5. `/api/v1/auth/me` 返回真实 `role`（非硬编码 `'admin'`），新注册普通用户前端不能看到管理员 UI。→ Task 6 手动验证步骤。

---

### Task 1: 给 `user` 表加 `role` 列（迁移 + backfill）

**Files:**
- Modify: `vico/server/src/db/auth-schema.ts:4-15`
- Create: `vico/server/drizzle/0010_add_user_role.sql`
- Modify: `vico/server/drizzle/meta/_journal.json:61-68`

**Interfaces:**
- Consumes: 无（第一阶段首个任务）。
- Produces: `user.role` 列（`text('role').notNull().default('user')`），后续 Task 4/5/6 依赖。

- [ ] **Step 1: 在 schema 中加列**

在 `vico/server/src/db/auth-schema.ts` 的 `user` 表定义中，`displayUsername` 之后加一行：

```typescript
  displayUsername: text('displayUsername'),
  // 角色：'admin'（仅 seed 管理员）| 'user'（默认，所有新增成员）
  role: text('role').notNull().default('user'),
```

- [ ] **Step 2: 手写迁移 SQL**

新建 `vico/server/drizzle/0010_add_user_role.sql`：

```sql
ALTER TABLE `user` ADD COLUMN `role` text NOT NULL DEFAULT 'user';
--> statement-breakpoint
UPDATE `user` SET `role` = 'admin' WHERE `username` = 'admin';
```

（backfill 处理**已存在**的库：把 seed 管理员 `admin` 置为 `admin`，其余保持默认 `'user'`；全新库此 UPDATE 在表空时为空操作，admin 由 Task 5 的 seed 写入 `role:'admin'`。）

- [ ] **Step 3: 同步 `_journal.json`**

在 `vico/server/drizzle/meta/_journal.json` 的 `entries` 数组里，把 `idx: 9` 那条的结尾 `}` 后加逗号，追加新条目：

```json
    {
      "idx": 10,
      "version": "6",
      "when": 1789488000000,
      "tag": "0010_add_user_role",
      "breakpoints": true
    }
```

- [ ] **Step 4: 运行迁移验证**

Run: `pnpm --filter @vico/server db:migrate`
Expected: 输出 `All migrations applied.`；随后 `sqlite3`/Drizzle 查询 `PRAGMA table_info(user)` 能看到 `role` 列，且既有 `admin` 行 `role='admin'`。

- [ ] **Step 5: Commit**

```bash
git add vico/server/src/db/auth-schema.ts vico/server/drizzle/0010_add_user_role.sql vico/server/drizzle/meta/_journal.json
git commit -m "feat: add role column to user table with admin backfill"
```

---

### Task 2: 抽取密码 helper 到 `lib/password.ts`

**Files:**
- Create: `vico/server/src/lib/password.ts`
- Test: `vico/server/src/lib/__tests__/password.test.ts`

**Interfaces:**
- Consumes: 无。
- Produces: `hashPassword(password: string): Promise<string>`（返回 `salt:hash`，hex），`verifyPassword(password: string, stored: string): Promise<boolean>`。Task 4/5 复用 `hashPassword`。

- [ ] **Step 1: 写失败测试**

新建 `vico/server/src/lib/__tests__/password.test.ts`：

```typescript
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
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @vico/server exec vitest run src/lib/__tests__/password.test.ts`
Expected: FAIL（`../password.js` 不存在）。

- [ ] **Step 3: 实现 helper**

新建 `vico/server/src/lib/password.ts`：

```typescript
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
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm --filter @vico/server exec vitest run src/lib/__tests__/password.test.ts`
Expected: 5 个用例全 PASS。

- [ ] **Step 5: Commit**

```bash
git add vico/server/src/lib/password.ts vico/server/src/lib/__tests__/password.test.ts
git commit -m "feat: extract scrypt password hash helper to lib/password"
```

---

### Task 3: 扩展 `getAuthContext` + 新增 `requireAdmin`

**Files:**
- Modify: `vico/server/src/api/helpers.ts`
- Test: `vico/server/src/api/__tests__/helpers.test.ts`

**Interfaces:**
- Consumes: `Variables` 类型（`../index.js`，type-only）。
- Produces: `ROLE_ADMIN = 'admin'`；`AuthContext = { userId: string; role: string }`；`getAuthContext(c)`；`requireAdmin(c): Promise<AuthContext | Response>`。Task 4/6 依赖。

- [ ] **Step 1: 写失败测试**

新建 `vico/server/src/api/__tests__/helpers.test.ts`：

```typescript
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
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @vico/server exec vitest run src/api/__tests__/helpers.test.ts`
Expected: FAIL（`requireAdmin`/`ROLE_ADMIN` 不存在，`role` 未返回）。

- [ ] **Step 3: 实现 helpers**

将 `vico/server/src/api/helpers.ts` 整体替换为：

```typescript
import type { Context } from 'hono';
import type { Variables } from '../index.js';

/** 管理员角色常量 */
export const ROLE_ADMIN = 'admin';

export interface AuthContext {
  userId: string;
  role: string;
}

/**
 * 从 better-auth session 提取 AuthContext，供路由处理函数使用。
 * 返回 { userId, role }；role 从 session user 读取，缺省为 'user'。
 *
 * @param c Hono 上下文
 * @returns AuthContext，若未认证则返回 401 Response
 */
export async function getAuthContext(c: Context<{ Variables: Variables }>): Promise<AuthContext | Response> {
  const session = c.get('session');
  const user = c.get('user');
  if (!session || !user) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  return {
    userId: user.id,
    role: user.role ?? 'user',
  };
}

/**
 * 管理员门控：先取 auth，非 admin 返回 403。
 * @param c Hono 上下文
 * @returns { userId, role } 或 401/403 Response
 */
export async function requireAdmin(c: Context<{ Variables: Variables }>): Promise<AuthContext | Response> {
  const auth = await getAuthContext(c);
  if (auth instanceof Response) return auth;
  if (auth.role !== ROLE_ADMIN) {
    return c.json({ error: 'Forbidden' }, 403);
  }
  return auth;
}
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm --filter @vico/server exec vitest run src/api/__tests__/helpers.test.ts`
Expected: 8 个用例全 PASS。

- [ ] **Step 5: Commit**

```bash
git add vico/server/src/api/helpers.ts vico/server/src/api/__tests__/helpers.test.ts
git commit -m "feat: add requireAdmin gate and role to auth context"
```

---

### Task 4: 新增 `api/users.ts`（列表 / 新增 / 删除）

**Files:**
- Create: `vico/server/src/api/users.ts`
- Modify: `vico/server/src/api/router.ts:3,13`
- Test: `vico/server/src/api/__tests__/users.test.ts`

**Interfaces:**
- Consumes: `requireAdmin`（Task 3）、`hashPassword`（Task 2）、`user`/`account` 表（Task 1）。
- Produces: `userRoutes(app)`、`checkDeleteUser(targetId, currentUserId, users)`、`createUserSchema`。

- [ ] **Step 1: 写失败测试**

新建 `vico/server/src/api/__tests__/users.test.ts`：

```typescript
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
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @vico/server exec vitest run src/api/__tests__/users.test.ts`
Expected: FAIL（`../users.js` 不存在）。

- [ ] **Step 3: 实现 users 路由**

新建 `vico/server/src/api/users.ts`：

```typescript
import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { v4 as uuid } from 'uuid';
import { z } from 'zod';
import type { Variables } from '../index.js';
import { requireAdmin } from './helpers.js';
import { getDb } from '../db/db.js';
import { account, user } from '../db/auth-schema.js';
import { hashPassword } from '../lib/password.js';

/** 新增成员请求体校验 */
export const createUserSchema = z.object({
  username: z.string().min(2, '用户名至少 2 个字符').max(50, '用户名最多 50 个字符'),
  name: z.string().min(1, '姓名不能为空').optional(),
  email: z.string().email('邮箱格式不正确'),
  password: z.string().min(8, '密码至少 8 位'),
});

export type DeleteUserCheck =
  | { allowed: true }
  | { allowed: false; status: 403; error: string };

/**
 * 删除成员守卫（纯函数，便于单测）。
 * 规则：不能删除自己；不能删除最后一个 admin。
 */
export function checkDeleteUser(
  targetId: string,
  currentUserId: string,
  users: Array<{ id: string; role: string }>,
): DeleteUserCheck {
  if (targetId === currentUserId) {
    return { allowed: false, status: 403, error: '不能删除当前登录账号' };
  }
  const target = users.find((u) => u.id === targetId);
  if (!target) return { allowed: true };
  if (target.role === 'admin') {
    const adminCount = users.filter((u) => u.role === 'admin').length;
    if (adminCount <= 1) {
      return { allowed: false, status: 403, error: '不能删除最后一个管理员' };
    }
  }
  return { allowed: true };
}

export function userRoutes(app: Hono<{ Variables: Variables }>) {
  app.get('/api/v1/users', async (c) => {
    const auth = await requireAdmin(c);
    if (auth instanceof Response) return auth;
    const rows = await getDb().select({
      id: user.id,
      username: user.username,
      displayUsername: user.displayUsername,
      name: user.name,
      email: user.email,
      role: user.role,
      createdAt: user.createdAt,
    }).from(user).all();
    return c.json(rows);
  });

  app.post('/api/v1/users', async (c) => {
    const auth = await requireAdmin(c);
    if (auth instanceof Response) return auth;
    const body = await c.req.json();
    const parsed = createUserSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: parsed.error.issues[0]?.message ?? '参数错误' }, 400);
    }
    const { username, name, email, password } = parsed.data;
    const db = getDb();

    const dupUsername = await db.select({ id: user.id }).from(user)
      .where(eq(user.username, username)).get();
    if (dupUsername) return c.json({ error: '用户名已存在' }, 409);
    const dupEmail = await db.select({ id: user.id }).from(user)
      .where(eq(user.email, email)).get();
    if (dupEmail) return c.json({ error: '邮箱已存在' }, 409);

    const now = new Date();
    const userId = uuid();
    await db.insert(user).values({
      id: userId,
      name: name ?? username,
      email,
      emailVerified: false,
      username,
      displayUsername: name ?? username,
      role: 'user',
      createdAt: now,
      updatedAt: now,
    }).run();

    const hash = await hashPassword(password);
    await db.insert(account).values({
      id: uuid(),
      userId,
      accountId: userId,
      providerId: 'credential',
      password: hash,
      createdAt: now,
      updatedAt: now,
    }).run();

    return c.json({ id: userId, username, name: name ?? username, email, role: 'user' }, 201);
  });

  app.delete('/api/v1/users/:id', async (c) => {
    const auth = await requireAdmin(c);
    if (auth instanceof Response) return auth;
    const id = c.req.param('id');
    const db = getDb();
    const users = await db.select({ id: user.id, role: user.role }).from(user).all();
    const check = checkDeleteUser(id, auth.userId, users);
    if (!check.allowed) return c.json({ error: check.error }, check.status);
    // FK onDelete: cascade 已配，删 user 自动清 session/account
    await db.delete(user).where(eq(user.id, id)).run();
    return c.json({ message: 'deleted' });
  });
}
```

- [ ] **Step 4: 在 router 注册**

`vico/server/src/api/router.ts`：加 `import { userRoutes } from './users.js';`，并在 `registerRoutes` 中 `modelRoutes(app);` 之后加 `userRoutes(app);`。

- [ ] **Step 5: 运行单测确认通过**

Run: `pnpm --filter @vico/server exec vitest run src/api/__tests__/users.test.ts`
Expected: 8 个用例全 PASS。

- [ ] **Step 6: 手动验证唯一冲突（Review Focus #2）**

Run: `pnpm --filter @vico/server dev`，用 admin/admin123 登录后，两次 `POST /api/v1/users` 传同一 `username`，第二次 Expected 409 + `{"error":"用户名已存在"}`；同邮箱同理。

- [ ] **Step 7: Commit**

```bash
git add vico/server/src/api/users.ts vico/server/src/api/router.ts vico/server/src/api/__tests__/users.test.ts
git commit -m "feat: add users API with admin-only list/create/delete"
```

---

### Task 5: seed 管理员写入 `role:'admin'` + 复用密码 helper + 修 issuer

**Files:**
- Modify: `vico/server/src/auth/seed.ts:1-5,48-71`

**Interfaces:**
- Consumes: `hashPassword`（Task 2）、`user.role` 列（Task 1）。
- Produces: 无新导出；修正 seed 行为。

- [ ] **Step 1: 改造 seed.ts**

改 `vico/server/src/auth/seed.ts`：

1. 顶部 import：删除 `import {randomBytes, scrypt} from 'node:crypto';`，加 `import {hashPassword} from '../lib/password.js';`。
2. 删除整个 `scryptConfig` 常量、`generateKey` 函数、局部 `hashPassword` 函数（已迁入 Task 2）。
3. 在 `seedDefaultAdmin` 的 user insert values 里加 `role: 'admin',`。
4. 删除 account insert values 里的 `issuer: 'local:credential',`（`account` 表无此列，属历史遗留 bug）。

改造后 `seedDefaultAdmin` 关键段为：

```typescript
  await db.insert(user).values({
    id: userId,
    name: '管理员',
    email: 'admin@vico.local',
    emailVerified: false,
    username: 'admin',
    displayUsername: '管理员',
    role: 'admin',
    createdAt: now,
    updatedAt: now,
  }).run();

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
```

- [ ] **Step 2: 类型检查**

Run: `pnpm --filter @vico/server exec tsc --noEmit`
Expected: 无类型错误（确认删掉 `issuer` 后不再有 schema 不匹配的隐患）。

- [ ] **Step 3: 手动验证（全新库）**

Run: `pnpm --filter @vico/server dev`
Expected: 启动日志 `Default admin created (admin / admin123)`；`GET /api/v1/auth/me` 在 Task 6 前暂为 `'admin'`，登录 `admin/admin123` 成功（确认删 issuer 未破坏登录）。

- [ ] **Step 4: Commit**

```bash
git add vico/server/src/auth/seed.ts
git commit -m "fix: seed admin with role and shared password helper, drop invalid issuer column"
```

---

### Task 6: models 写操作门控 + auth/me 返回真实 role

**Files:**
- Modify: `vico/server/src/api/models.ts:17-39`
- Modify: `vico/server/src/api/auth.ts:10-19`

**Interfaces:**
- Consumes: `requireAdmin`（Task 3）。
- Produces: 无新导出。

- [ ] **Step 1: models.ts 写操作改 `requireAdmin`**

`vico/server/src/api/models.ts`：把 import 改为 `import { getAuthContext, requireAdmin } from './helpers.js';`。`POST`/`PATCH`/`DELETE` 三个 handler 的 `const auth = await getAuthContext(c); if (auth instanceof Response) return auth;` 改为 `const auth = await requireAdmin(c); if (auth instanceof Response) return auth;`。`GET` 保持 `getAuthContext` 不变（任意登录用户可读，Agent 选模型依赖）。

- [ ] **Step 2: auth/me 返回真实 role**

`vico/server/src/api/auth.ts` 的 `/api/v1/auth/me` handler，把 `role: 'admin',` 改为：

```typescript
      role: (user as { role?: string }).role ?? 'user',
```

- [ ] **Step 3: 类型检查**

Run: `pnpm --filter @vico/server exec tsc --noEmit`
Expected: 无类型错误。

- [ ] **Step 4: 手动验证（Review Focus #1 / #5）**

Run: `pnpm --filter @vico/server dev`
Expected:
- 以 admin 登录，`PATCH /api/v1/models/:id` 成功；以新注册普通用户登录，同一请求返回 403。
- 以新注册普通用户登录，`GET /api/v1/auth/me` 返回 `role: 'user'`。

- [ ] **Step 5: Commit**

```bash
git add vico/server/src/api/models.ts vico/server/src/api/auth.ts
git commit -m "feat: gate model writes behind admin and return real role in /auth/me"
```

---

### Task 7: 前端 ThemeProvider

**Files:**
- Create: `vico/web/src/hooks/use-theme.tsx`
- Modify: `vico/web/src/main.tsx:1-27`

**Interfaces:**
- Consumes: 无。
- Produces: `ThemeProvider({ children })`、`useTheme(): { theme: 'light' | 'dark'; setTheme(t) }`。Task 9 依赖。

- [ ] **Step 1: 实现 ThemeProvider**

新建 `vico/web/src/hooks/use-theme.tsx`：

```tsx
// 1. React
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

type Theme = 'light' | 'dark';
const STORAGE_KEY = 'theme';

const ThemeContext = createContext<{ theme: Theme; setTheme: (t: Theme) => void } | null>(null);

/** 主题提供者 — 切换 <html>.dark class，localStorage 持久化，默认 light */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === 'dark' ? 'dark' : 'light';
  });

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('dark', theme === 'dark');
    localStorage.setItem(STORAGE_KEY, theme);
  }, [theme]);

  const setTheme = (t: Theme) => setThemeState(t);

  return (
    <ThemeContext.Provider value={{ theme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}
```

- [ ] **Step 2: 在 main.tsx 包裹**

`vico/web/src/main.tsx`：import `ThemeProvider`，在 `<TooltipProvider>` 内层包裹：

```tsx
      <TooltipProvider>
        <ThemeProvider>
          <RouterProvider router={router} />
          <Toaster />
        </ThemeProvider>
      </TooltipProvider>
```

- [ ] **Step 3: 类型检查**

Run: `pnpm --filter @vico/web build`
Expected: 构建通过。

- [ ] **Step 4: Commit**

```bash
git add vico/web/src/hooks/use-theme.tsx vico/web/src/main.tsx
git commit -m "feat: add ThemeProvider for light/dark theme switching"
```

---

### Task 8: i18n 文案（settings 命名空间三语言）

**Files:**
- Modify: `vico/web/src/i18n/locales/zh-CN/settings.json`
- Modify: `vico/web/src/i18n/locales/zh-TW/settings.json`
- Modify: `vico/web/src/i18n/locales/en/settings.json`

**Interfaces:**
- Consumes: 无。
- Produces: `general.theme*`、`users.*`、改名的 `general.tab`/`llm.tab`，供 Task 9/10/11/12 使用。

- [ ] **Step 1: 更新 zh-CN**

`vico/web/src/i18n/locales/zh-CN/settings.json` 整体替换为（保留原有 `llm.*` 内容）：

```json
{
  "title": "设置",
  "general": {
    "tab": "常规设置",
    "language": "界面语言",
    "languageDesc": "选择界面显示语言，更改后立即生效",
    "theme": "界面主题",
    "themeDesc": "选择界面主题配色，更改后立即生效",
    "light": "浅色",
    "dark": "深色"
  },
  "users": {
    "tab": "用户管理",
    "title": "用户管理",
    "description": "管理平台成员账号和角色权限",
    "addUser": "添加成员",
    "username": "用户名",
    "name": "姓名",
    "email": "邮箱",
    "password": "密码",
    "role": "角色",
    "roleAdmin": "管理员",
    "roleUser": "普通用户",
    "emptyTitle": "暂无成员",
    "emptyDescription": "添加第一个成员账号，共同使用该平台",
    "confirmDeleteTitle": "确认删除",
    "confirmDeleteDesc": "确定要删除成员「{{name}}」吗？该操作不可撤销。",
    "addDialogTitle": "添加成员",
    "addDialogDesc": "填写新成员的基本信息和登录凭据",
    "usernamePlaceholder": "登录用户名",
    "namePlaceholder": "成员姓名",
    "emailPlaceholder": "name@example.com",
    "passwordPlaceholder": "至少 8 位"
  },
  "llm": {
    "tab": "模型管理",
    "title": "LLM 模型设置",
    "description": "管理 AI 模型提供商和 API 密钥，配置后可被 Agent 引用",
    "addModel": "添加模型",
    "modelName": "模型名称",
    "provider": "提供商",
    "apiKey": "API Key",
    "baseUrl": "Base URL",
    "actions": "操作",
    "emptyTitle": "暂无模型",
    "emptyDescription": "添加您的第一个 LLM 模型提供商，为 Agent 提供推理能力",
    "confirmDeleteTitle": "确认删除",
    "confirmDeleteDesc": "确定要删除模型配置「{{name}}」吗？引用该模型的 Agent 将无法正常工作。",
    "addDialogTitle": "添加 LLM 模型",
    "addDialogDesc": "选择一个模型提供商并填写对应的 API Key 和模型名称",
    "editDialogTitle": "编辑 LLM 模型",
    "editDialogDesc": "修改模型配置信息，API Key 留空则保持现有密钥不变",
    "providerLabel": "提供商",
    "providerPlaceholder": "选择提供商",
    "modelNameLabel": "模型名称",
    "modelNamePlaceholder": "e.g. {{name}}",
    "apiKeyLabel": "API Key",
    "apiKeyPlaceholder": "sk-...",
    "baseUrlLabel": "Base URL",
    "baseUrlReset": "重置为默认 URL",
    "cancel": "取消",
    "edit": "编辑",
    "add": "添加",
    "adding": "添加中...",
    "save": "保存",
    "saving": "保存中...",
    "apiKeyKeepHint": "留空则保持现有密钥不变",
    "isDefaultLabel": "设为默认模型",
    "defaultBadge": "默认",
    "setDefault": "设为默认",
    "customProvider": "自定义"
  }
}
```

- [ ] **Step 2: 更新 zh-TW**

`vico/web/src/i18n/locales/zh-TW/settings.json` 整体替换（繁体，`llm.*` 结构与 zh-CN 对齐）：

```json
{
  "title": "設定",
  "general": {
    "tab": "一般設定",
    "language": "介面語言",
    "languageDesc": "選擇介面顯示語言，變更後立即生效",
    "theme": "介面主題",
    "themeDesc": "選擇介面主題配色，變更後立即生效",
    "light": "淺色",
    "dark": "深色"
  },
  "users": {
    "tab": "使用者管理",
    "title": "使用者管理",
    "description": "管理平台成員帳號與角色權限",
    "addUser": "新增成員",
    "username": "使用者名稱",
    "name": "姓名",
    "email": "電子郵件",
    "password": "密碼",
    "role": "角色",
    "roleAdmin": "管理員",
    "roleUser": "一般使用者",
    "emptyTitle": "尚無成員",
    "emptyDescription": "新增第一個成員帳號，共同使用此平台",
    "confirmDeleteTitle": "確認刪除",
    "confirmDeleteDesc": "確定要刪除成員「{{name}}」嗎？此操作無法復原。",
    "addDialogTitle": "新增成員",
    "addDialogDesc": "填寫新成員的基本資訊與登入憑證",
    "usernamePlaceholder": "登入使用者名稱",
    "namePlaceholder": "成員姓名",
    "emailPlaceholder": "name@example.com",
    "passwordPlaceholder": "至少 8 位"
  },
  "llm": {
    "tab": "模型管理",
    "title": "LLM 模型設定",
    "description": "管理 AI 模型提供商和 API 金鑰，配置後可供 Agent 引用",
    "addModel": "新增模型",
    "modelName": "模型名稱",
    "provider": "提供商",
    "apiKey": "API Key",
    "baseUrl": "Base URL",
    "actions": "操作",
    "emptyTitle": "尚無模型",
    "emptyDescription": "新增您的第一個 LLM 模型提供商，為 Agent 提供推理能力",
    "confirmDeleteTitle": "確認刪除",
    "confirmDeleteDesc": "確定要刪除模型配置「{{name}}」嗎？引用該模型的 Agent 將無法正常運作。",
    "addDialogTitle": "新增 LLM 模型",
    "addDialogDesc": "選擇一個模型提供商並填寫對應的 API Key 和模型名稱",
    "editDialogTitle": "編輯 LLM 模型",
    "editDialogDesc": "修改模型配置資訊，API Key 留空則保持現有金鑰不變",
    "providerLabel": "提供商",
    "providerPlaceholder": "選擇提供商",
    "modelNameLabel": "模型名稱",
    "modelNamePlaceholder": "e.g. {{name}}",
    "apiKeyLabel": "API Key",
    "apiKeyPlaceholder": "sk-...",
    "baseUrlLabel": "Base URL",
    "baseUrlReset": "重設為預設 URL",
    "cancel": "取消",
    "edit": "編輯",
    "add": "新增",
    "adding": "新增中...",
    "save": "儲存",
    "saving": "儲存中...",
    "apiKeyKeepHint": "留空則保持現有金鑰不變",
    "isDefaultLabel": "設為預設模型",
    "defaultBadge": "預設",
    "setDefault": "設為預設",
    "customProvider": "自訂"
  }
}
```

- [ ] **Step 3: 更新 en**

`vico/web/src/i18n/locales/en/settings.json` 整体替换：

```json
{
  "title": "Settings",
  "general": {
    "tab": "General",
    "language": "Interface Language",
    "languageDesc": "Select the display language. Changes take effect immediately.",
    "theme": "Interface Theme",
    "themeDesc": "Select the theme color scheme. Changes take effect immediately.",
    "light": "Light",
    "dark": "Dark"
  },
  "users": {
    "tab": "Users",
    "title": "User Management",
    "description": "Manage platform member accounts and roles",
    "addUser": "Add Member",
    "username": "Username",
    "name": "Name",
    "email": "Email",
    "password": "Password",
    "role": "Role",
    "roleAdmin": "Admin",
    "roleUser": "User",
    "emptyTitle": "No Members",
    "emptyDescription": "Add the first member account to collaborate on this platform",
    "confirmDeleteTitle": "Confirm Delete",
    "confirmDeleteDesc": "Are you sure you want to delete member \"{{name}}\"? This cannot be undone.",
    "addDialogTitle": "Add Member",
    "addDialogDesc": "Fill in the new member's basic info and login credentials",
    "usernamePlaceholder": "Login username",
    "namePlaceholder": "Member name",
    "emailPlaceholder": "name@example.com",
    "passwordPlaceholder": "At least 8 characters"
  },
  "llm": {
    "tab": "Models",
    "title": "LLM Model Settings",
    "description": "Manage AI model providers and API keys for Agent use",
    "addModel": "Add Model",
    "modelName": "Model Name",
    "provider": "Provider",
    "apiKey": "API Key",
    "baseUrl": "Base URL",
    "actions": "Actions",
    "emptyTitle": "No Models",
    "emptyDescription": "Add your first LLM model provider to enable reasoning for Agents",
    "confirmDeleteTitle": "Confirm Delete",
    "confirmDeleteDesc": "Are you sure you want to delete model configuration \"{{name}}\"? Agents using this model may not work properly.",
    "addDialogTitle": "Add LLM Model",
    "addDialogDesc": "Select a model provider and enter the corresponding API Key and model name",
    "editDialogTitle": "Edit LLM Model",
    "editDialogDesc": "Modify model configuration. Leave API Key blank to keep the existing key.",
    "providerLabel": "Provider",
    "providerPlaceholder": "Select Provider",
    "modelNameLabel": "Model Name",
    "modelNamePlaceholder": "e.g. {{name}}",
    "apiKeyLabel": "API Key",
    "apiKeyPlaceholder": "sk-...",
    "baseUrlLabel": "Base URL",
    "baseUrlReset": "Reset to default URL",
    "cancel": "Cancel",
    "edit": "Edit",
    "add": "Add",
    "adding": "Adding...",
    "save": "Save",
    "saving": "Saving...",
    "apiKeyKeepHint": "Leave blank to keep existing key",
    "isDefaultLabel": "Set as default model",
    "defaultBadge": "Default",
    "setDefault": "Set as default",
    "customProvider": "Custom"
  }
}
```

- [ ] **Step 4: 类型检查**

Run: `pnpm --filter @vico/web build`
Expected: 构建通过。

- [ ] **Step 5: Commit**

```bash
git add vico/web/src/i18n/locales/zh-CN/settings.json vico/web/src/i18n/locales/zh-TW/settings.json vico/web/src/i18n/locales/en/settings.json
git commit -m "feat: add users/theme i18n keys and rename settings tabs"
```

---

### Task 9: 抽取 PROVIDER_PRESETS + GeneralSettings（语言 + 主题）

**Files:**
- Create: `vico/web/src/pages/settings/providers.ts`
- Create: `vico/web/src/pages/settings/GeneralSettings.tsx`
- Modify: `vico/web/src/pages/settings/AddModelDialog.tsx:22-49`

**Interfaces:**
- Consumes: `useTheme`（Task 7）、i18n `general.*`（Task 8）。
- Produces: `PROVIDER_PRESETS`（Task 10 复用）、`GeneralSettings` 组件（Task 12 引用）。

- [ ] **Step 1: 抽取 PROVIDER_PRESETS**

新建 `vico/web/src/pages/settings/providers.ts`：

```typescript
/** 提供商预设配置：包含默认的 baseURL 和推荐模型列表 */
export const PROVIDER_PRESETS: Record<string, { label: string; baseURL: string; models: string[] }> = {
  openai: {
    label: 'OpenAI',
    baseURL: 'https://api.openai.com/v1',
    models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'o3-mini'],
  },
  anthropic: {
    label: 'Anthropic',
    baseURL: 'https://api.anthropic.com/v1',
    models: ['claude-sonnet-4-6', 'claude-opus-4-6', 'claude-haiku-4-5'],
  },
  deepseek: {
    label: 'DeepSeek',
    baseURL: 'https://api.deepseek.com/v1',
    models: ['deepseek-chat', 'deepseek-coder'],
  },
  qwen: {
    label: '通义千问',
    baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    models: ['qwen-plus', 'qwen-max', 'qwen-turbo'],
  },
  custom: {
    label: '自定义',
    baseURL: '',
    models: [],
  },
};
```

- [ ] **Step 2: AddModelDialog 改用共享常量**

`vico/web/src/pages/settings/AddModelDialog.tsx`：删除本地 `PROVIDER_PRESETS` 定义（第 22-49 行），加 `import { PROVIDER_PRESETS } from './providers';`。

- [ ] **Step 3: 实现 GeneralSettings**

新建 `vico/web/src/pages/settings/GeneralSettings.tsx`：

```tsx
// 1. 第三方
import { useTranslation } from 'react-i18next';

// 2. Hooks
import { useTheme } from '@/hooks/use-theme';

// 3. UI 组件
import {
  Card, CardHeader, CardTitle, CardDescription, CardContent,
} from '@/components/ui/card';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';

/** 支持的语言列表，标签以各语言本机名称显示 */
const LANGUAGES = [
  { value: 'zh-CN', label: '简体中文' },
  { value: 'zh-TW', label: '繁體中文' },
  { value: 'en', label: 'English' },
] as const;

/** 常规设置：界面语言 + 界面主题 */
export default function GeneralSettings() {
  const { t, i18n } = useTranslation('settings');
  const { theme, setTheme } = useTheme();

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>{t('general.language')}</CardTitle>
          <CardDescription>{t('general.languageDesc')}</CardDescription>
        </CardHeader>
        <CardContent>
          <Select value={i18n.language} onValueChange={(lang) => i18n.changeLanguage(lang)}>
            <SelectTrigger className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LANGUAGES.map(({ value, label }) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('general.theme')}</CardTitle>
          <CardDescription>{t('general.themeDesc')}</CardDescription>
        </CardHeader>
        <CardContent>
          <Select value={theme} onValueChange={(v) => setTheme(v as 'light' | 'dark')}>
            <SelectTrigger className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="light">{t('general.light')}</SelectItem>
              <SelectItem value="dark">{t('general.dark')}</SelectItem>
            </SelectContent>
          </Select>
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 4: 类型检查**

Run: `pnpm --filter @vico/web build`
Expected: 构建通过（`GeneralSettings` 为新增组件；`Settings.tsx` 仍用旧的 `LanguageSwitcher` + 本地模型逻辑，本步不改动它）。

- [ ] **Step 5: Commit**

```bash
git add vico/web/src/pages/settings/providers.ts vico/web/src/pages/settings/GeneralSettings.tsx vico/web/src/pages/settings/AddModelDialog.tsx
git commit -m "feat: extract provider presets and add GeneralSettings (language + theme)"
```

---

### Task 10: ModelManagement（现有模型 CRUD 迁入 + 角色只读）

**Files:**
- Create: `vico/web/src/pages/settings/ModelManagement.tsx`

**Interfaces:**
- Consumes: `PROVIDER_PRESETS`（Task 9）、`AddModelDialog`、`isAdmin: boolean` prop（Task 12 传入）。
- Produces: `ModelManagement({ isAdmin })` 组件。

- [ ] **Step 1: 实现 ModelManagement**

新建 `vico/web/src/pages/settings/ModelManagement.tsx`（把原 `Settings.tsx` 的模型逻辑原样迁入，写操作按 `isAdmin` 门控）：

```tsx
// 1. React
import { useCallback, useState } from 'react';

// 2. 第三方
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, Check, Pencil } from 'lucide-react';

// 3. API
import { api } from '@/api/client';

// 4. UI 组件
import {
  Card, CardContent,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Empty, EmptyTitle, EmptyDescription } from '@/components/ui/empty';
import { Dialog, DialogTrigger } from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogTrigger, AlertDialogContent,
  AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter,
} from '@/components/ui/alert-dialog';

// 5. 页面子组件
import AddModelDialog from './AddModelDialog';
import { PROVIDER_PRESETS } from './providers';

/** LLM 模型数据结构 */
interface ModelEntry {
  id: string;
  provider: string;
  model_name: string;
  api_key: string;
  base_url: string | null;
  is_default: number;
}

/**
 * 模型管理 section：列表 + 增/改/删/设默认。
 * 非 admin（isAdmin=false）隐藏所有写操作按钮，列表只读。
 */
export default function ModelManagement({ isAdmin }: { isAdmin: boolean }) {
  const { t } = useTranslation('settings');
  const queryClient = useQueryClient();

  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [editingModelId, setEditingModelId] = useState<string | null>(null);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);

  const [provider, setProvider] = useState('openai');
  const [modelName, setModelName] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [baseURL, setBaseURL] = useState(PROVIDER_PRESETS.openai.baseURL);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [isDefault, setIsDefault] = useState(false);

  const { data: models, isLoading } = useQuery<ModelEntry[]>({
    queryKey: ['models'],
    queryFn: () => api('/models'),
  });

  const modelsList = models || [];
  const currentPresetModels = PROVIDER_PRESETS[provider]?.models || [];
  const isBaseURLModified = !!(PROVIDER_PRESETS[provider]?.baseURL && baseURL !== PROVIDER_PRESETS[provider].baseURL);

  const addMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) =>
      api('/models', { method: 'POST', body: JSON.stringify(data) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['models'] });
      resetFormDialog();
    },
  });

  const editMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) =>
      api(`/models/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['models'] });
      resetFormDialog();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api(`/models/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['models'] });
      setDeleteTargetId(null);
    },
  });

  const setDefaultMutation = useMutation({
    mutationFn: (id: string) =>
      api(`/models/${id}`, { method: 'PATCH', body: JSON.stringify({ is_default: 1 }) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['models'] }),
  });

  const resetFormDialog = useCallback(() => {
    setAddDialogOpen(false);
    setEditingModelId(null);
    setModelName('');
    setApiKey('');
    setProvider('openai');
    setBaseURL(PROVIDER_PRESETS.openai.baseURL);
    setIsDefault(false);
  }, []);

  const openAddDialog = useCallback(() => {
    setEditingModelId(null);
    setModelName('');
    setApiKey('');
    setProvider('openai');
    setBaseURL(PROVIDER_PRESETS.openai.baseURL);
    setIsDefault(modelsList.length === 0);
    setAddDialogOpen(true);
  }, [modelsList.length]);

  const openEditDialog = useCallback((model: ModelEntry) => {
    setEditingModelId(model.id);
    setProvider(model.provider);
    setModelName(model.model_name);
    setApiKey('');
    setBaseURL(model.base_url || PROVIDER_PRESETS[model.provider]?.baseURL || '');
    setIsDefault(model.is_default === 1);
    setAddDialogOpen(true);
  }, []);

  const handleProviderChange = useCallback((newProvider: string) => {
    setProvider(newProvider);
    const preset = PROVIDER_PRESETS[newProvider];
    if (preset) setBaseURL(preset.baseURL);
  }, []);

  const handleModelSuggestionPick = useCallback((name: string) => {
    setModelName(name);
    setShowSuggestions(false);
  }, []);

  const handleResetBaseURL = useCallback(() => {
    const preset = PROVIDER_PRESETS[provider];
    if (preset) setBaseURL(preset.baseURL);
  }, [provider]);

  const handleSubmit = useCallback(() => {
    if (!modelName.trim()) return;
    if (!editingModelId && !apiKey.trim()) return;

    if (editingModelId) {
      const patchData: Record<string, unknown> = {
        provider,
        model_name: modelName.trim(),
        base_url: baseURL || null,
        is_default: isDefault ? 1 : 0,
      };
      if (apiKey.trim()) patchData.api_key = apiKey.trim();
      editMutation.mutate({ id: editingModelId, data: patchData });
    } else {
      addMutation.mutate({
        provider,
        model_name: modelName.trim(),
        api_key: apiKey.trim(),
        base_url: baseURL || null,
        is_default: isDefault ? 1 : 0,
      });
    }
  }, [editingModelId, modelName, apiKey, provider, baseURL, addMutation, editMutation]);

  const handleDeleteConfirm = useCallback(() => {
    if (deleteTargetId) deleteMutation.mutate(deleteTargetId);
  }, [deleteTargetId, deleteMutation]);

  if (isLoading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Card key={i}>
            <CardContent className="py-6">
              <Skeleton className="h-5 w-48" />
              <Skeleton className="h-3 w-72 mt-2" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">{t('llm.title')}</h3>
          <p className="text-sm text-muted-foreground mt-1">{t('llm.description')}</p>
        </div>
        {isAdmin && (
          <Dialog open={addDialogOpen} onOpenChange={(open) => { if (!open) resetFormDialog(); }}>
            <DialogTrigger asChild>
              <Button onClick={openAddDialog}>
                <Plus className="size-4" />
                {t('llm.addModel')}
              </Button>
            </DialogTrigger>
            <AddModelDialog
              isEdit={!!editingModelId}
              provider={provider}
              onProviderChange={handleProviderChange}
              modelName={modelName}
              onModelNameChange={setModelName}
              apiKey={apiKey}
              onApiKeyChange={setApiKey}
              baseURL={baseURL}
              onBaseURLChange={setBaseURL}
              showSuggestions={showSuggestions}
              onShowSuggestionsChange={setShowSuggestions}
              currentPresetModels={currentPresetModels}
              isBaseURLModified={isBaseURLModified}
              onResetBaseURL={handleResetBaseURL}
              onModelSuggestionPick={handleModelSuggestionPick}
              isDefault={isDefault}
              onIsDefaultChange={setIsDefault}
              onSubmit={handleSubmit}
              isPending={addMutation.isPending || editMutation.isPending}
            />
          </Dialog>
        )}
      </div>

      {modelsList.length === 0 ? (
        <Empty>
          <EmptyTitle>{t('llm.emptyTitle')}</EmptyTitle>
          <EmptyDescription>{t('llm.emptyDescription')}</EmptyDescription>
        </Empty>
      ) : (
        <div className="space-y-3">
          {modelsList.map((m) => (
            <Card key={m.id}>
              <CardContent className="py-0">
                <div className="flex items-center justify-between py-4">
                  <div className="flex items-center gap-3 min-w-0">
                    {m.is_default === 1 && (
                      <div className="flex size-5 shrink-0 items-center justify-center rounded-full bg-green-100 text-green-600">
                        <Check className="size-3" />
                      </div>
                    )}
                    <div className="min-w-0">
                      <p className="font-medium truncate">{m.provider} / {m.model_name}</p>
                      <p className="text-xs text-muted-foreground truncate">
                        API Key: {m.api_key.slice(0, 8)}...
                        {m.base_url ? ` \u00b7 ${m.base_url}` : ''}
                      </p>
                    </div>
                  </div>
                  {isAdmin && (
                    <div className="flex items-center gap-2 shrink-0">
                      {m.is_default !== 1 && (
                        <Button
                          variant="outline"
                          size="xs"
                          onClick={() => setDefaultMutation.mutate(m.id)}
                          disabled={setDefaultMutation.isPending}
                        >
                          {t('llm.setDefault')}
                        </Button>
                      )}
                      {m.is_default === 1 && <Badge variant="default">{t('llm.defaultBadge')}</Badge>}
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        className="text-muted-foreground hover:text-foreground"
                        onClick={() => openEditDialog(m)}
                      >
                        <Pencil className="size-3.5" />
                        <span className="sr-only">{t('llm.edit')}</span>
                      </Button>
                      <AlertDialog
                        open={deleteTargetId === m.id}
                        onOpenChange={(open) => { if (!open) setDeleteTargetId(null); }}
                      >
                        <AlertDialogTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            className="text-muted-foreground hover:text-destructive"
                            onClick={() => setDeleteTargetId(m.id)}
                          >
                            <Trash2 className="size-3.5" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>{t('llm.confirmDeleteTitle')}</AlertDialogTitle>
                            <AlertDialogDescription>
                              {t('llm.confirmDeleteDesc', { name: `${m.provider} / ${m.model_name}` })}
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <Button variant="outline" onClick={() => setDeleteTargetId(null)}>
                              {t('llm.cancel')}
                            </Button>
                            <Button
                              variant="destructive"
                              onClick={handleDeleteConfirm}
                              disabled={deleteMutation.isPending}
                            >
                              {deleteMutation.isPending ? t('common:deleting') : t('common:confirmDelete')}
                            </Button>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: 类型检查**

Run: `pnpm --filter @vico/web build`
Expected: 构建通过。

- [ ] **Step 3: 手动验证角色只读（Review Focus #1 前端侧）**

以普通用户登录访问 `/settings?section=models`，Expected 列表可读、无「添加模型」按钮、无编辑/删除/设默认按钮。

- [ ] **Step 4: Commit**

```bash
git add vico/web/src/pages/settings/ModelManagement.tsx
git commit -m "feat: move model CRUD into ModelManagement with admin write gating"
```

---

### Task 11: UserManagement + AddUserDialog

**Files:**
- Create: `vico/web/src/pages/settings/UserManagement.tsx`
- Create: `vico/web/src/pages/settings/AddUserDialog.tsx`

**Interfaces:**
- Consumes: `api('/users')`（Task 4）、i18n `users.*`（Task 8）。
- Produces: `UserManagement` 组件（Task 12 引用）、`AddUserDialog`。

- [ ] **Step 1: 实现 AddUserDialog**

新建 `vico/web/src/pages/settings/AddUserDialog.tsx`：

```tsx
// 1. React
import { useState } from 'react';

// 2. 第三方
import { useTranslation } from 'react-i18next';

// 4. UI 组件
import {
  DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface AddUserDialogProps {
  /** 提交回调 */
  onSubmit: (data: { username: string; name: string; email: string; password: string }) => void;
  /** 是否提交中 */
  isPending: boolean;
}

/** 添加成员对话框：用户名 + 姓名 + 邮箱 + 密码 */
export default function AddUserDialog({ onSubmit, isPending }: AddUserDialogProps) {
  const { t } = useTranslation('settings');
  const [username, setUsername] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const canSubmit =
    username.trim().length >= 2 &&
    name.trim().length > 0 &&
    email.trim().length > 0 &&
    password.length >= 8;

  const handleSubmit = () => {
    if (!canSubmit) return;
    onSubmit({ username: username.trim(), name: name.trim(), email: email.trim(), password });
  };

  return (
    <DialogContent className="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>{t('users.addDialogTitle')}</DialogTitle>
        <DialogDescription>{t('users.addDialogDesc')}</DialogDescription>
      </DialogHeader>
      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="user-username">{t('users.username')}</Label>
          <Input
            id="user-username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder={t('users.usernamePlaceholder')}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="user-name">{t('users.name')}</Label>
          <Input
            id="user-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('users.namePlaceholder')}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="user-email">{t('users.email')}</Label>
          <Input
            id="user-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={t('users.emailPlaceholder')}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="user-password">{t('users.password')}</Label>
          <Input
            id="user-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={t('users.passwordPlaceholder')}
          />
        </div>
      </div>
      <DialogFooter showCloseButton>
        <Button onClick={handleSubmit} disabled={!canSubmit || isPending}>
          {isPending ? t('common:creating') : t('common:create')}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
```

- [ ] **Step 2: 实现 UserManagement**

新建 `vico/web/src/pages/settings/UserManagement.tsx`：

```tsx
// 1. React
import { useState } from 'react';

// 2. 第三方
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

// 3. API
import { api } from '@/api/client';

// 4. UI 组件
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Empty, EmptyTitle, EmptyDescription } from '@/components/ui/empty';
import { Dialog, DialogTrigger } from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogTrigger, AlertDialogContent,
  AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter,
} from '@/components/ui/alert-dialog';

// 5. 页面子组件
import AddUserDialog from './AddUserDialog';

/** 用户列表条目 */
interface UserEntry {
  id: string;
  username: string | null;
  displayUsername: string | null;
  name: string;
  email: string;
  role: string;
  createdAt: string;
}

/** 用户管理 section：列表 + 新增成员 + 删除成员（仅 admin 可见） */
export default function UserManagement() {
  const { t } = useTranslation('settings');
  const queryClient = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<UserEntry | null>(null);

  const { data: users, isLoading, isError } = useQuery<UserEntry[]>({
    queryKey: ['users'],
    queryFn: () => api('/users'),
  });

  const addMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) =>
      api('/users', { method: 'POST', body: JSON.stringify(data) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      setAddOpen(false);
    },
    onError: (err) => toast.error(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api(`/users/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      setDeleteTarget(null);
    },
    onError: (err) => {
      toast.error(err.message);
      setDeleteTarget(null);
    },
  });

  if (isLoading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Card key={i}>
            <CardContent className="py-6">
              <Skeleton className="h-5 w-48" />
              <Skeleton className="h-3 w-72 mt-2" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  if (isError) {
    return <p className="text-sm text-muted-foreground">{t('common:operationFailed')}</p>;
  }

  const list = users || [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">{t('users.title')}</h3>
          <p className="text-sm text-muted-foreground mt-1">{t('users.description')}</p>
        </div>
        <Dialog open={addOpen} onOpenChange={setAddOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="size-4" />
              {t('users.addUser')}
            </Button>
          </DialogTrigger>
          <AddUserDialog
            onSubmit={(data) => addMutation.mutate(data)}
            isPending={addMutation.isPending}
          />
        </Dialog>
      </div>

      {list.length === 0 ? (
        <Empty>
          <EmptyTitle>{t('users.emptyTitle')}</EmptyTitle>
          <EmptyDescription>{t('users.emptyDescription')}</EmptyDescription>
        </Empty>
      ) : (
        <div className="space-y-3">
          {list.map((u) => (
            <Card key={u.id}>
              <CardContent className="py-0">
                <div className="flex items-center justify-between py-4">
                  <div className="min-w-0">
                    <p className="font-medium truncate">
                      {u.displayUsername || u.username || u.name}
                    </p>
                    <p className="text-xs text-muted-foreground truncate">
                      {u.username} · {u.email}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Badge variant={u.role === 'admin' ? 'default' : 'secondary'}>
                      {u.role === 'admin' ? t('users.roleAdmin') : t('users.roleUser')}
                    </Badge>
                    <AlertDialog
                      open={deleteTarget?.id === u.id}
                      onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
                    >
                      <AlertDialogTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          className="text-muted-foreground hover:text-destructive"
                          onClick={() => setDeleteTarget(u)}
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>{t('users.confirmDeleteTitle')}</AlertDialogTitle>
                          <AlertDialogDescription>
                            {t('users.confirmDeleteDesc', { name: u.displayUsername || u.username || u.name })}
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <Button variant="outline" onClick={() => setDeleteTarget(null)}>
                            {t('common:cancel')}
                          </Button>
                          <Button
                            variant="destructive"
                            onClick={() => deleteMutation.mutate(u.id)}
                            disabled={deleteMutation.isPending}
                          >
                            {deleteMutation.isPending ? t('common:deleting') : t('common:confirmDelete')}
                          </Button>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2b: 类型检查**

Run: `pnpm --filter @vico/web build`
Expected: 构建通过。

- [ ] **Step 3: 手动验证增删 + 守卫**

Run: `pnpm dev`，admin 登录访问 `/settings?section=users`，Expected：
- 列表显示 admin（角色徽章「管理员」）。
- 新增成员成功（toast 无报错），新成员 `role='user'`。
- 删除普通成员成功；对 admin 自己点删除 → toast「不能删除当前登录账号」。

- [ ] **Step 4: Commit**

```bash
git add vico/web/src/pages/settings/UserManagement.tsx vico/web/src/pages/settings/AddUserDialog.tsx
git commit -m "feat: add user management section with add/delete dialogs"
```

---

### Task 12: 重写 Settings 壳（左侧分组导航 + section 路由 + 角色门控）

**Files:**
- Modify: `vico/web/src/pages/Settings.tsx`（整体重写）
- Delete: `vico/web/src/pages/settings/LanguageSwitcher.tsx`

**Interfaces:**
- Consumes: `GeneralSettings`（Task 9）、`ModelManagement`（Task 10）、`UserManagement`（Task 11）、`useAuth`。
- Produces: `Settings` 壳，`?section=general|users|models` deep-link。

- [ ] **Step 1: 重写 Settings.tsx**

`vico/web/src/pages/Settings.tsx` 整体替换为：

```tsx
// 1. 第三方
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { Settings as SettingsIcon, Users, Cpu } from 'lucide-react';

// 2. Hooks
import { useAuth } from '@/hooks/use-auth';

// 3. 工具
import { cn } from '@/lib/utils';

// 4. 页面子组件
import GeneralSettings from './settings/GeneralSettings';
import UserManagement from './settings/UserManagement';
import ModelManagement from './settings/ModelManagement';

/**
 * 设置页面壳
 *
 * 左侧分组导航 + 右侧内容，`?section=` deep-link。
 * 角色门控：非 admin 隐藏「用户管理」nav 项。
 */
export default function Settings() {
  const { t } = useTranslation('settings');
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();

  const isAdmin = user?.role === 'admin';

  const navItems = [
    { value: 'general', label: t('general.tab'), icon: SettingsIcon, adminOnly: false },
    { value: 'users', label: t('users.tab'), icon: Users, adminOnly: true },
    { value: 'models', label: t('llm.tab'), icon: Cpu, adminOnly: false },
  ].filter((i) => !i.adminOnly || isAdmin);

  const rawSection = searchParams.get('section') ?? 'general';
  const section = navItems.some((i) => i.value === rawSection) ? rawSection : 'general';

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold tracking-tight">{t('title')}</h2>

      <div className="flex gap-6">
        <nav className="w-48 shrink-0 space-y-1">
          {navItems.map((item) => (
            <button
              key={item.value}
              type="button"
              onClick={() => setSearchParams({ section: item.value })}
              className={cn(
                'flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                section === item.value
                  ? 'bg-accent text-accent-foreground'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              <item.icon size={14} />
              {item.label}
            </button>
          ))}
        </nav>

        <div className="min-w-0 flex-1">
          {section === 'general' && <GeneralSettings />}
          {section === 'users' && <UserManagement />}
          {section === 'models' && <ModelManagement isAdmin={isAdmin} />}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 删除 LanguageSwitcher**

删除 `vico/web/src/pages/settings/LanguageSwitcher.tsx`（逻辑已并入 Task 9 的 `GeneralSettings`，本步 Settings.tsx 已不再引用它）。

- [ ] **Step 3: 类型检查**

Run: `pnpm --filter @vico/web build`
Expected: 构建通过。

- [ ] **Step 4: 手动验证 deep-link**

Run: `pnpm dev`，访问 `/settings`、`/settings?section=models`、`/settings?section=users`，Expected 三个 section 正确切换；URL 同步更新。

- [ ] **Step 5: Commit**

```bash
git add vico/web/src/pages/Settings.tsx
git rm vico/web/src/pages/settings/LanguageSwitcher.tsx
git commit -m "feat: rewrite Settings as left-nav shell with role gating"
```

---

### Task 13: 全量回归 + 冒烟

**Files:**
- 无新文件（验证性任务）。

- [ ] **Step 1: 后端单测全跑**

Run: `pnpm --filter @vico/server exec vitest run`
Expected: 全部 PASS（含 password / helpers / users 新增用例）。

- [ ] **Step 2: 后端类型检查**

Run: `pnpm --filter @vico/server exec tsc --noEmit`
Expected: 无错误。

- [ ] **Step 3: 前端构建**

Run: `pnpm --filter @vico/web build`
Expected: 构建通过。

- [ ] **Step 4: CI 冒烟**

Run: `pnpm --filter @vico/server eval:ci`
Expected: 冒烟通过（如本仓库冒烟脚本依赖模型/agent 数据，以现有通过基线为准）。

- [ ] **Step 5: 整体手测**

以 admin 登录：切三个 section、切主题（刷新后保持）、切语言、增删用户、模型增改删设默认。以普通用户登录：无「用户管理」nav、模型列表只读。

- [ ] **Step 6: 提交收尾（如有遗漏文件）**

```bash
git status
# 如有遗漏改动，补 git add + commit；否则无需额外提交
```
