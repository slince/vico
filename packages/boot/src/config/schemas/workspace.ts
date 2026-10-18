// @vico/boot - Workspace 基础工具配置段

import { z } from 'zod';

/** Workspace 基础工具配置（文件读写、命令执行等） */
export const workspaceSchema = z.object({
  base_path: z.string().default('./workspace'),
  contained: z.boolean().default(true),
  allowed_paths: z.array(z.string()).default([]),
  timeout_ms: z.number().default(30000),
  isolation: z.enum(['none', 'seatbelt', 'bwrap']).default('none'),
});
