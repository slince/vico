// @vico/bash - 本地命令执行器：真实派发子进程执行命令

import { spawn } from 'node:child_process';
import { once } from 'node:events';

import type { Command, CommandResult } from './command.js';
import type { CommandExecutor } from './executor.js';

/**
 * 本地执行器构造参数。
 *
 * - `command`：可执行文件路径（如 `/bin/bash`）
 * - `args`：把命令原文转换为参数数组的工厂（如 `(c) => ['-c', c]`）
 * - `env`：执行器级环境变量覆盖（叠加在 `process.env` 之上）
 */
export interface LocalExecutorOptions {
  command: string;
  args?: (command: string) => string[];
  env?: NodeJS.ProcessEnv;
}

/**
 * 本地命令执行器：通过 `node:child_process.spawn` 真实派发子进程。
 *
 * 完整复刻原 `bash-tool` 的 `runCommand` 行为，并额外补齐超时判定与耗时统计：
 * - 通过 `spawn` 的 `timeout` 选项触发超时（SIGTERM 终止子进程）
 * - 从 `close` 事件的 `signal` 判定 `timedOut`
 * - `durationMs` 为派发到关闭的墙钟耗时
 */
export class LocalCommandExecutor implements CommandExecutor {
  private readonly command: string;

  private readonly args: (command: string) => string[];

  private readonly env?: NodeJS.ProcessEnv;

  constructor(options: LocalExecutorOptions) {
    this.command = options.command;
    this.args = options.args ?? ((c: string) => ['-c', c]);
    this.env = options.env;
  }

  /**
   * 执行一条命令，收集 stdout / stderr，进程结束后返回结果。
   *
   * @param command 待执行的命令（来自 {@link parseCommand}）
   * @returns 执行结果（stdout / stderr / exitCode / durationMs / timedOut）
   */
  async execute(command: Command): Promise<CommandResult> {
    // 环境变量解析优先级：process.env（含 HOME 兜底）→ 执行器 env → 命令 env
    const env = {
      ...process.env,
      HOME: process.env.HOME ?? '/root',
      ...this.env,
      ...command.env,
    };

    const startedAt = Date.now();

    const child = spawn(this.command, this.args(command.raw), {
      cwd: command.cwd,
      timeout: command.timeout,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    try {
      // close 事件的第二个参数是终止信号；被 spawn 的 timeout 以 SIGTERM
      // 终止时会得到 (null, 'SIGTERM')，据此判定超时
      const [code, signal] = (await once(child, 'close')) as [number | null, NodeJS.Signals | null];

      return {
        stdout,
        stderr,
        exitCode: code,
        durationMs: Date.now() - startedAt,
        timedOut: signal != null,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);

      return {
        stdout,
        stderr: stderr ? `${stderr}\nError: ${message}` : `Error: ${message}`,
        exitCode: 1,
        durationMs: Date.now() - startedAt,
        timedOut: false,
      };
    }
  }
}

/**
 * 默认本地执行器单例：以 `/bin/bash -c` 方式派发命令。
 */
export const localCommandExecutor: CommandExecutor = new LocalCommandExecutor({
  command: '/bin/bash',
  args: (c) => ['-c', c],
});
