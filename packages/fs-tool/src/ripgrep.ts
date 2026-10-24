// @vico/fs-tool - ripgrep 二进制运行封装
import { execFile } from 'node:child_process';
import { isAbsolute, relative, sep } from 'node:path';

/** 搜索超时（ms） */
const SEARCH_TIMEOUT_MS = 30_000;

/** 原始 stdout 上限（字节） */
const RAW_OUTPUT_MAX_BYTES = 20 * 1024 * 1024;

let rgPathPromise: Promise<string> | undefined;

/** 解析打包的 ripgrep 二进制路径（进程内懒加载一次） */
function resolveRgPath(): Promise<string> {
  rgPathPromise ??= (async () => (await import('@vscode/ripgrep')).rgPath)();
  return rgPathPromise;
}

/** 一次 ripgrep 运行的结果 */
export interface RipgrepResult {
  stdout: string;
  /** rg 退出码 1：搜索成功但零结果 */
  noMatches: boolean;
}

/**
 * 运行打包的 ripgrep，argv 不含二进制本身。
 * @param argv - ripgrep 参数向量（每个值都是独立 argv 元素，无 shell 层）
 * @param opts - cwd 与取消信号
 */
export async function runRipgrep(
  argv: string[],
  opts?: { cwd?: string; signal?: AbortSignal },
): Promise<RipgrepResult> {
  const rgPath = await resolveRgPath();

  try {
    const stdout = await execFileText(rgPath, ['--no-config', ...argv], opts);
    return { stdout, noMatches: false };
  } catch (err) {
    const e = err as { code?: number | string; stdout?: string; stderr?: string };
    // rg 退出码 1 = 搜索成功但零结果
    if (e.code === 1) return { stdout: e.stdout ?? '', noMatches: true };
    const stderr = (e.stderr ?? '').trim();
    throw new Error(`ripgrep failed (exit ${e.code ?? 'unknown'})${stderr ? `: ${stderr}` : ''}`);
  }
}

/** execFile 的 Promise 包装：拿到完整 stdout，异常时保留 code/stdout/stderr */
function execFileText(
  file: string,
  args: string[],
  opts?: { cwd?: string; signal?: AbortSignal },
): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      file,
      args,
      {
        cwd: opts?.cwd,
        encoding: 'utf-8',
        timeout: SEARCH_TIMEOUT_MS,
        maxBuffer: RAW_OUTPUT_MAX_BYTES,
        signal: opts?.signal,
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(Object.assign(error, { stdout, stderr }));
        } else {
          resolve(stdout);
        }
      },
    );
  });
}

/**
 * 把 rg 输出的路径转为相对 workdir 的显示路径：workdir 内的绝对路径转相对，
 * 其余（相对输出、workdir 外的绝对路径）原样返回。
 */
export function toWorkdirRelative(path: string, workdir: string): string {
  if (!isAbsolute(path)) return path;
  const rel = relative(workdir, path);
  if (rel.length === 0) return '.';
  if (rel === '..' || rel.startsWith(`..${sep}`)) return path;
  return rel;
}
