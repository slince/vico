// src/tool/builtin/workspace.ts
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
 * 将目标路径解析为工作区内的绝对路径，并校验 containment。
 *
 * - 相对路径相对于 workspace 根目录解析
 * - 绝对路径也必须在 workspace 范围内，否则抛出错误
 * - 自动展开路径中的 ~ 为用户主目录
 *
 * @param workspace - 工作区根路径（可能包含 ~）
 * @param targetPath - 目标路径（相对或绝对）
 * @returns 解析后的绝对路径
 * @throws 如果路径在工作区之外则抛出错误
 */
export function resolveWorkspacePath(workspace: string, targetPath: string): string {
  const ws = resolve(expandTilde(workspace));
  const abs = targetPath.startsWith('/') ? targetPath : resolve(ws, targetPath);

  // 所有路径（包括绝对路径）都必须在 workspace 范围内
  if (!abs.startsWith(ws + '/') && abs !== ws) {
    throw new Error(`Path "${targetPath}" is outside the workspace`);
  }
  return abs;
}
