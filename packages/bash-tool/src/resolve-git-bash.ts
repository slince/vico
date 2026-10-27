// @vico/bash-tool - Git Bash 可执行文件解析（Windows）

import { lstatSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 判断候选路径是否可被 spawn。
 *
 * 用 lstatSync 打开入口本身而非跟随 reparse point；目录恒不匹配。
 * 与 `resolve-pwsh` 的 candidateExists 保持同一判定口径。
 */
function candidateExists(candidate: string): boolean {
  try {
    const stat = lstatSync(candidate);
    return stat.isFile() || stat.isSymbolicLink();
  } catch {
    // 仅 ENOENT 属预期（候选在探测前消失）；其余错误同样视为不可 spawn。
    return false;
  }
}

/**
 * 枚举 Windows 上常见的 Git Bash 安装位置与 PATH 候选。
 *
 * 显式接收 env 使解析在各平台都是纯函数（与 `resolve-pwsh` 的 candidatePwshPaths 一致）。
 *
 * @param env - 待探测的环境变量，默认 process.env
 * @returns 候选 bash.exe 路径，按解析优先级排列
 */
export function candidateGitBashPaths(env: NodeJS.ProcessEnv = process.env): string[] {
  const candidates: string[] = [];

  // 常见安装根目录下的 Git Bash 入口（含 Git for Windows 的 usr/bin 布局）
  const push = (base: string | undefined, ...rest: string[]): void => {
    if (base) candidates.push(join(base, ...rest));
  };
  push(env.ProgramFiles, 'Git', 'bin', 'bash.exe');
  push(env.ProgramFiles, 'Git', 'usr', 'bin', 'bash.exe');
  push(env['ProgramFiles(x86)'], 'Git', 'bin', 'bash.exe');
  push(env.LocalAppData, 'Programs', 'Git', 'bin', 'bash.exe');

  // PATH 上的 bash.exe（scoop / choco 等自定义安装）；条目可能带 setx 风格引号，先剥离
  for (const entry of (env.PATH ?? '').split(';')) {
    const trimmed = entry.trim().replace(/^"|"$/g, '');
    if (trimmed.length === 0) continue;
    candidates.push(join(trimmed, 'bash.exe'));
  }

  return candidates;
}

/**
 * 解析 Windows 上的 Git Bash 可执行文件路径。
 *
 * 依次探测常见安装位置与 PATH；非 Windows 或全部未命中时返回 undefined
 * （调用方据此回退到 pwsh）。
 *
 * @param configured - 显式配置的 bashPath，非空则直接信任
 * @param env - 探测用环境变量，默认 process.env
 * @param platform - 目标平台，默认 process.platform
 * @returns 可 spawn 的 bash.exe 路径；不可用时返回 undefined
 */
export function resolveGitBashPath(
  configured?: string,
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string | undefined {
  if (configured !== undefined && configured.length > 0) return configured;
  if (platform !== 'win32') return undefined;

  for (const candidate of candidateGitBashPaths(env)) {
    if (candidateExists(candidate)) return candidate;
  }

  return undefined;
}
