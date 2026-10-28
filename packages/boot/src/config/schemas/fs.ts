// @vico/boot - 文件系统（工作空间 + 文件系统后端）配置段

import { z } from 'zod';

/** 文件系统配置：默认工作空间路径与文件系统后端 */
export const fsSchema = z.object({
  base_path: z.string().default('./workspace'),
  filesystem_backend: z.enum(['local']).default('local'),
});
