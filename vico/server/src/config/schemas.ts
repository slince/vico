/**
 * server 应用层配置段 schema — 通过 provider 注册进 boot 容器。
 *
 * framework 段（agent/skills/memory/model/rag/tool/workspace/checkpoint/storage）由
 * `@vico/boot` 的 `createVicoContainer` 定义；这里只声明 server 专属的应用层段，
 * 并通过 `ServerConfigKeys` 扩展 framework 段映射，让 `getConfig('database')` /
 * `getConfig('upload')` 等在容器上类型可用。
 */
import { z } from 'zod';
import type { VicoConfigKeys, VicoTokens } from '@vico/boot';
import type { Container, ServiceProvider } from '@vico/di';

/** HTTP 服务配置 */
export const serverSchema = z.object({
  port: z.number().default(3001),
  deploy_mode: z.enum(['private', 'saas']).default('private'),
});

/** 认证配置（会话有效期等） */
export const authSchema = z.object({
  session_expiry_days: z.number().default(7),
});

/** 数据库连接配置（libsql url） */
export const databaseSchema = z.object({
  url: z.string().default('file:./data/vico.db'),
});

/** 知识库文件持久化存储配置（local / s3） */
export const fileStorageSchema = z.object({
  type: z.enum(['local', 's3']).default('local'),
  root: z.string().default('./data/storage'),
  endpoint: z.string().optional(),
  region: z.string().optional(),
  access_key_id: z.string().optional(),
  secret_access_key: z.string().optional(),
  bucket: z.string().optional(),
});

/** 文件上传配置 */
export const uploadSchema = z.object({
  max_size_bytes: z.number().default(50 * 1024 * 1024),
  allowed_mime_types: z.array(z.string()).default([
    'application/pdf',
    'text/plain',
    'text/markdown',
    'text/csv',
    'text/x-python',
    'text/javascript',
    'application/json',
  ]),
});

/** server 配置段映射：framework 段 + 应用层专属段 */
export interface ServerConfigKeys extends VicoConfigKeys {
  server: typeof serverSchema;
  auth: typeof authSchema;
  database: typeof databaseSchema;
  file_storage: typeof fileStorageSchema;
  upload: typeof uploadSchema;
}

/** server 容器类型（framework + 应用层配置段） */
export type ServerContainer = Container<undefined, VicoTokens, ServerConfigKeys>;

/** server provider 类型 */
export type ServerServiceProvider = ServiceProvider<undefined, VicoTokens, ServerConfigKeys>;
