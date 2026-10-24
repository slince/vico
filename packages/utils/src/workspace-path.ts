// @vico/utils - workspace 路径解析

import { resolve } from 'node:path';
import { homedir } from 'node:os';

/**
 * 展开路径中的波浪号（~）为用户主目录。
 *
 * @param p - 可能包含 ~ 的路径
 * @returns 展开后的路径
 */
function expandTilde(p: string): string {
  if (p.startsWith('~')) {
    return resolve(homedir(), p.slice(p.startsWith('~/') ? 2 : 1));
  }
  return p;
}

/**
 * 将目标路径解析为绝对路径。
 *
 * - 相对路径相对于 workspace 根目录解析
 * - 绝对路径直接使用
 * - 自动展开 workspace 中的 ~ 为用户主目录
 *
 * @param workspace - 工作区根路径（可能包含 ~）
 * @param targetPath - 目标路径（相对或绝对）
 * @returns 解析后的绝对路径
 */
export function resolveWorkspacePath(workspace: string, targetPath: string): string {
  if (!workspace) {
    throw new Error('Workspace path is required but not configured. Please configure a workspace for this agent.');
  }
  const ws = resolve(expandTilde(workspace));
  return targetPath.startsWith('/') ? targetPath : resolve(ws, targetPath);
}
