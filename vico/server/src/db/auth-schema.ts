import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

/** better-auth 核心用户表 — 替代原有 users 表 */
export const user = sqliteTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: integer('emailVerified', { mode: 'boolean' }).notNull().default(false),
  image: text('image'),
  createdAt: integer('createdAt', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updatedAt', { mode: 'timestamp' }).notNull(),
  // username 插件字段
  username: text('username').unique(),
  displayUsername: text('displayUsername'),
});

/** better-auth 会话表 */
export const session = sqliteTable('session', {
  id: text('id').primaryKey(),
  userId: text('userId').notNull().references(() => user.id, { onDelete: 'cascade' }),
  token: text('token').notNull().unique(),
  expiresAt: integer('expiresAt', { mode: 'timestamp' }).notNull(),
  ipAddress: text('ipAddress'),
  userAgent: text('userAgent'),
  createdAt: integer('createdAt', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updatedAt', { mode: 'timestamp' }).notNull(),
});

/** better-auth 账户关联表（OAuth + 密码凭证） */
export const account = sqliteTable('account', {
  id: text('id').primaryKey(),
  userId: text('userId').notNull().references(() => user.id, { onDelete: 'cascade' }),
  accountId: text('accountId').notNull(),
  providerId: text('providerId').notNull(),
  accessToken: text('accessToken'),
  refreshToken: text('refreshToken'),
  idToken: text('idToken'),
  accessTokenExpiresAt: integer('accessTokenExpiresAt', { mode: 'timestamp' }),
  refreshTokenExpiresAt: integer('refreshTokenExpiresAt', { mode: 'timestamp' }),
  scope: text('scope'),
  password: text('password'),
  createdAt: integer('createdAt', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updatedAt', { mode: 'timestamp' }).notNull(),
});

/** better-auth 验证表（邮箱验证等） */
export const verification = sqliteTable('verification', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: integer('expiresAt', { mode: 'timestamp' }).notNull(),
  createdAt: integer('createdAt', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updatedAt', { mode: 'timestamp' }).notNull(),
});

