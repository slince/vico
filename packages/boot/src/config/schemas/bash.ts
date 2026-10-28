// @vico/boot - shell 命令执行配置段（backend + ssh 连接）

import { z } from 'zod';

/** shell 命令执行配置：执行后端（local/ssh）与 ssh 连接参数 */
export const bashSchema = z.object({
  backend: z.enum(['local', 'ssh']).default('local'),
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
