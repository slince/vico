// @vico/boot - 工作空间领域 provider（默认工作空间路径）

import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { workspaceSchema } from '../config/schemas/index.js';
import type { VicoServiceProvider } from '../tokens.js';

/**
 * 展开路径开头的 `~` 为用户主目录，并解析为绝对路径。
 *
 * `workspace.base_path` 允许 `~/vico` 或 `./workspace` 这类写法；消费点期望拿到一个
 * 可直接作为工具工作目录的绝对路径，故统一在此展开 `~` 并相对进程 cwd 解析。
 *
 * @param p - 原始 base_path
 * @returns 展开 `~` 后的绝对路径
 */
function resolveWorkspaceRoot(p: string): string {
  const expanded = p.startsWith('~')
    ? resolve(homedir(), p.slice(p.startsWith('~/') ? 2 : 1))
    : p;
  return resolve(expanded);
}

/**
 * 工作空间 provider：声明 `workspace` 配置段 schema，并注册 `workspace` 服务
 * （默认工作空间 = `workspace.base_path` 展开 `~` 并解析为绝对路径）。
 *
 * Agent 未单独指定 workspace 时，server 层从此取默认值兜底，避免各消费点
 * 各自重复展开 base_path。
 */
export const workspaceProvider: VicoServiceProvider = {
  register(c) {
    c.registerConfig('workspace', workspaceSchema);

    c.register('workspace', ({ getConfig }) => resolveWorkspaceRoot(getConfig('workspace').base_path));
  },
};
