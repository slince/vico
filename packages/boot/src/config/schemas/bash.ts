// @vico/boot - shell 命令执行配置段（backend + 沙箱/隔离选项 + ssh 连接）

import { z } from 'zod';

/** shell 命令执行配置：执行后端（local/ssh）、沙箱/隔离选项与 ssh 连接参数 */
export const bashSchema = z.object({
  backend: z.enum(['local', 'ssh']).default('local'),
  contained: z.boolean().default(true),
  allowed_paths: z.array(z.string()).default([]),
  timeout_ms: z.number().default(30000),
  isolation: z.enum(['none', 'seatbelt', 'bwrap']).default('none'),
  ssh: z
    .object({
      host: z.string().default(''),
      port: z.number().default(22),
      username: z.string().default(''),
      password: z.string().optional(),
      private_key: z.string().optional(),
      passphrase: z.string().optional(),
    })
    .default({ host: '', port: 22, username: '' }),
});
