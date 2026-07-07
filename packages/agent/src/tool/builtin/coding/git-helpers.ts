import {execSync} from 'node:child_process';

/** 在 workspace 目录执行 git 命令并返回输出 */
export function git(cwd: string, args: string[]): string {
  return execSync(`git ${args.join(' ')}`, {
    cwd,
    encoding: 'utf-8',
    timeout: 30000,
    maxBuffer: 10 * 1024 * 1024,
  }).trim();
}

/** 安全执行 git 命令，失败时返回错误信息 */
export function gitSafe(cwd: string, args: string[]): { output: string; error?: string } {
  try {
    return { output: git(cwd, args) };
  } catch (err: any) {
    return { output: '', error: err.stderr?.trim() || err.message };
  }
}
