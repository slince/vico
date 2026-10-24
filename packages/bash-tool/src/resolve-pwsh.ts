// @vico/bash-tool - PowerShell 可执行文件解析（Windows）

import { lstatSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 枚举 Windows 上常见的 PowerShell 安装位置与 PATH 候选，最新优先。
 *
 * 显式接收 env 使解析在各平台都是纯函数（参考 deepseek-harness 的
 * dsh-pwsh-local/resolve 思路）。
 *
 * @param env - 待探测的环境变量，默认 process.env
 * @returns 候选 pwsh/powershell 可执行文件路径，按解析优先级排列
 */
export function candidatePwshPaths(env: NodeJS.ProcessEnv = process.env): string[] {
  const programFiles = env.ProgramFiles ?? 'C:\\Program Files';
  const systemRoot = env.SystemRoot ?? 'C:\\Windows';
  const candidates = [
    join(programFiles, 'PowerShell', '7', 'pwsh.exe'),
  ];
  // Microsoft Store（及任意用户自定义位置）安装在 PATH 上；
  // 条目可能带 setx 风格的前后引号，需先剥离。
  for (const entry of (env.PATH ?? '').split(';')) {
    const trimmed = entry.trim().replace(/^"|"$/g, '');
    if (trimmed.length === 0) continue;
    candidates.push(join(trimmed, 'pwsh.exe'));
  }
  // Windows PowerShell 5.1 作为最后回退。
  candidates.push(join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'));
  return candidates;
}

/**
 * 判断候选路径是否可被 spawn。
 *
 * 用 lstatSync 打开入口本身而非跟随 reparse point，以兼容 Store 执行别名
 * （Node 新版上报为 symlink、旧版为普通文件）；目录恒不匹配。
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
 * 解析 pwsh 可执行文件路径。
 *
 * Windows 上依次探测 PowerShell 7 → PATH/Store → Windows PowerShell 5.1；
 * 其它平台或全部未命中时回退为 'pwsh'（走 PATH 解析）。
 *
 * @param configured - 显式配置的 pwshPath，非空则直接信任
 * @param env - 探测用环境变量，默认 process.env
 * @param platform - 目标平台，默认 process.platform
 * @returns 可 spawn 的 pwsh/powershell 路径
 */
export function resolvePwshPath(
  configured?: string,
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string {
  if (configured !== undefined && configured.length > 0) return configured;
  if (platform === 'win32') {
    for (const candidate of candidatePwshPaths(env)) {
      if (candidateExists(candidate)) return candidate;
    }
  }
  return 'pwsh';
}
