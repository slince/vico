// @vico/bash-tool — Shell 命令执行工具（bash / pwsh），薄壳委托 @vico/bash

import { LocalCommandExecutor } from '@vico/bash';
import type { Tool } from '@vico/tool';
import { bashTool, createBashTool } from './bash-tool.js';
import { createPwshTool, pwshTool } from './pwsh-tool.js';
import { resolveGitBashPath } from './resolve-git-bash.js';

export { bashTool, createBashTool, createPwshTool, pwshTool };

/** 选择 shell 工具时的可选探测参数（默认读 process.platform / process.env） */
export interface ShellToolOptions {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
}

/**
 * 创建当前主机合适的 shell 工具。
 *
 * 规则：Windows 且找不到 Git Bash 时用 pwsh；其余情况（含 Windows 装有 Git Bash）
 * 用 bash —— Windows 上的 bash 经 Git Bash 的 bash.exe 派发，而非 POSIX 的 /bin/bash。
 *
 * @param options - 可选探测参数（平台 / 环境变量），便于测试注入
 * @returns bash 或 pwsh 工具
 */
export function createShellTool(options: ShellToolOptions = {}): Tool {
  const platform = options.platform ?? process.platform;

  if (platform === 'win32') {
    const gitBash = resolveGitBashPath(undefined, options.env ?? process.env, platform);
    if (!gitBash) {
      return createPwshTool();
    }
    return createBashTool({
      executor: new LocalCommandExecutor({ command: gitBash, args: (c) => ['-c', c] }),
    });
  }

  return createBashTool();
}
