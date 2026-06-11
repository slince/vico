/**
 * Vico 认证模块 — 基于 better-auth
 * 提供邮箱/用户名密码认证、Session 管理、多租户（组织）支持
 */
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { username } from 'better-auth/plugins';
import { organization } from 'better-auth/plugins';
import { getDb } from '../data/db.js';
import * as authSchema from '../data/auth-schema.js';

export const auth = betterAuth({
  database: drizzleAdapter(getDb(), {
    provider: 'sqlite',
    schema: authSchema,
  }),

  /** 邮箱密码登录（同时启用 username 插件，支持用户名登录） */
  emailAndPassword: {
    enabled: true,
    autoSignIn: true,
    requireEmailVerification: false,
  },

  /** 用户名登录插件 */
  plugins: [
    username({
      minUsernameLength: 2,
      maxUsernameLength: 50,
    }),
    organization({
      allowUserToCreateOrganization: true,
    }),
  ],

  /** Session 配置 — 7 天有效期，与旧 JWT token_expiry 一致 */
  session: {
    expiresIn: 60 * 60 * 24 * 7,
    updateAge: 60 * 60 * 24,
  },

  /** Cookie 配置 — 开发环境（localhost HTTP） */
  advanced: {
    cookiePrefix: 'vico',
    defaultCookieAttributes: {
      sameSite: 'lax',
      secure: false,
      httpOnly: true,
    },
    crossSubDomainCookies: {
      enabled: false,
    },
  },

  /** 信任 Vite 开发服务器来源 */
  trustedOrigins: ['http://localhost:5173'],

  /** 密钥 — 替代原 jwt_secret */
  secret: process.env.BETTER_AUTH_SECRET || 'dev-secret-change-me-in-production',
});
