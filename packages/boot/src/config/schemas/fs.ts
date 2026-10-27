// @vico/boot - 文件系统（工作空间 + 文件系统后端）配置段

import { z } from 'zod';

/** 文件系统配置：默认工作空间路径、沙箱/隔离选项与文件系统后端 */
export const fsSchema = z.object({
  base_path: z.string().default('./workspace'),
  contained: z.boolean().default(true),
  allowed_paths: z.array(z.string()).default([]),
  timeout_ms: z.number().default(30000),
  isolation: z.enum(['none', 'seatbelt', 'bwrap']).default('none'),
  filesystem_backend: z.enum(['local']).default('local'),
});
