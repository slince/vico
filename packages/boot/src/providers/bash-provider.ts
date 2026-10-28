// @vico/boot - shell 命令执行领域 provider（backend：local / ssh）

import { z } from 'zod';
import { createBashTool, createShellTool } from '@vico/bash-tool';
import { SshCommandExecutor } from '@vico/bash-ssh';
import type { SshConnectionOptions } from '@vico/bash-ssh';
import { bashSchema } from '../config/schemas/index.js';
import type { VicoServiceProvider } from '../tokens.js';

/**
 * 把 `bash.ssh` 子配置转换为 SSH 执行器的连接参数。
 *
 * `password` / `private_key` / `passphrase` 为可选认证项，仅在显式配置时透传，
 * 避免空字符串覆盖 `SshCommandExecutor` 对缺省认证的语义。
 *
 * @param cfg - bash 配置段解析结果
 * @returns SSH 连接参数
 */
function toSshOptions(cfg: z.infer<typeof bashSchema>): SshConnectionOptions {
  const ssh = cfg.ssh;

  return {
    host: ssh.host,
    port: ssh.port,
    username: ssh.username,
    ...(ssh.password !== undefined ? { password: ssh.password } : {}),
    ...(ssh.private_key !== undefined ? { privateKey: ssh.private_key } : {}),
    ...(ssh.passphrase !== undefined ? { passphrase: ssh.passphrase } : {}),
  };
}

/**
 * shell 命令执行 provider：声明 `bash` 配置段 schema，并注册 shell 工具服务——
 *
 * - `backend: local`：按当前主机自动选择 bash（含 Windows Git Bash）/ pwsh；
 * - `backend: ssh`：以 `SshCommandExecutor` 经 SSH 在远端执行 bash 命令。
 */
export const bashProvider: VicoServiceProvider = {
  register(c) {
    c.registerConfig('bash', bashSchema);

    c.register('shellTool', ({ getConfig }) => {
      const cfg = getConfig('bash');

      if (cfg.backend === 'ssh') {
        return createBashTool({ executor: new SshCommandExecutor(toSshOptions(cfg)) });
      }

      return createShellTool();
    });
  },
};
