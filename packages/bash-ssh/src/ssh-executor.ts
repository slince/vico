// @vico/bash-ssh - SSH 命令执行适配器：序列化远端命令 + 通过 ssh2 执行

import { Client } from 'ssh2';

import type { Command, CommandResult } from '@vico/bash';
import type { CommandExecutor } from '@vico/bash';

/**
 * SSH 连接配置。
 *
 * - `host` / `username`：必填
 * - `port`：缺省 22
 * - 认证三选一：`password`，或 `privateKey`（可配 `passphrase`）
 */
export interface SshConnectionOptions {
  host: string;
  port?: number;
  username: string;
  password?: string;
  privateKey?: string | Buffer;
  passphrase?: string;
}

/**
 * 用单引号包裹并转义值中的单引号（标准 shell 惯用法：`'` → `'\''`）。
 *
 * 单引号内除单引号自身外均为字面量，因此只需把内嵌的 `'` 改写为 `'\''`
 * 再整体包裹，即可安全地在远端 shell 中保真传值。
 *
 * @param value 待包裹的原始值
 * @returns 单引号包裹、内嵌单引号已转义的 shell 字面量
 */
function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

/**
 * 把解析后的命令序列化为远端 shell 命令行。
 *
 * 顺序：每条 env 生成 `export KEY=<quoted value>; ` 前缀（键不引、值单引号
 * 包裹），随后（仅当 cwd 存在时）追加 `cd <quoted cwd> && `，最后拼接
 * `command.raw`；无 env / cwd 时直接输出 `raw`。
 *
 * @param command 待执行的命令（来自 {@link parseCommand}）
 * @returns 远端可直接交给 shell 执行的命令行字符串
 */
export function buildRemoteCommand(command: Command): string {
  const envPrefix = Object.entries(command.env ?? {})
    .map(([key, value]) => `export ${key}=${shellQuote(value)}; `)
    .join('');

  const cwdPrefix = command.cwd ? `cd ${shellQuote(command.cwd)} && ` : '';

  return `${envPrefix}${cwdPrefix}${command.raw}`;
}

/**
 * SSH 命令执行器：惰性建立并复用一条 `ssh2.Client` 连接，在远端执行命令。
 *
 * - 首次 `execute` 时建立连接，后续复用；`dispose()` 显式关闭连接
 * - 通过 `client.exec(buildRemoteCommand(command))` 派发，收集 stdout / stderr
 * - 退出码取 `close` 事件首参；`command.timeout` 到点关闭 channel 触发 `timedOut`
 */
export class SshCommandExecutor implements CommandExecutor {
  private readonly options: SshConnectionOptions;

  private client?: Client;

  constructor(options: SshConnectionOptions) {
    this.options = options;
  }

  /**
   * 在远端执行一条命令并收集结果。
   *
   * @param command 待执行的命令（来自 {@link parseCommand}）
   * @returns 执行结果（stdout / stderr / exitCode / durationMs / timedOut）
   */
  async execute(command: Command): Promise<CommandResult> {
    const client = await this.getClient();
    return this.execRemote(client, command);
  }

  /**
   * 关闭底层 SSH 连接（幂等，未连接时为空操作）。
   */
  async dispose(): Promise<void> {
    this.client?.end();
    this.client = undefined;
  }

  /**
   * 惰性建立并缓存连接：首次调用创建 `Client`，等待 ready 后复用。
   *
   * 连接建立后被断开时（`close` 事件）清空缓存指针，下一次调用自动重建。
   */
  private getClient(): Promise<Client> {
    if (this.client) {
      return Promise.resolve(this.client);
    }

    const client = new Client();

    return new Promise<Client>((resolve, reject) => {
      // ready 前的连接错误拒绝本次建立；ready 后保持挂载以免未捕获异常
      client.on('error', (err: Error) => {
        if (!this.client) {
          reject(err);
        }
      });

      client.once('ready', () => {
        this.client = client;
        resolve(client);
      });

      // 连接建立后被对端断开：把缓存指针置空，下一次 execute 惰性重建连接
      client.on('close', () => {
        if (this.client === client) {
          this.client = undefined;
        }
      });

      client.connect(this.options);
    });
  }

  /**
   * 在已建立的连接上执行命令，收集 stdout / stderr 与退出码。
   */
  private execRemote(client: Client, command: Command): Promise<CommandResult> {
    const startedAt = Date.now();
    const remote = buildRemoteCommand(command);

    return new Promise<CommandResult>((resolve) => {
      let stdout = '';
      let stderr = '';
      let timedOut = false;
      let settled = false;

      const finish = (exitCode: number | null) => {
        if (settled) return;
        settled = true;
        resolve({
          stdout,
          stderr,
          exitCode,
          durationMs: Date.now() - startedAt,
          timedOut,
        });
      };

      client.exec(remote, (err, channel) => {
        if (err) {
          resolve({
            stdout: '',
            stderr: `Error: ${err.message}`,
            exitCode: 1,
            durationMs: Date.now() - startedAt,
            timedOut: false,
          });
          return;
        }

        // 超时定时器：到点置 timedOut、关闭 channel 并直接收尾（settled 防重入）
        const timer = setTimeout(() => {
          timedOut = true;
          channel.close();
          finish(null);
        }, command.timeout);

        const onClose = (exitCode: number | null) => {
          clearTimeout(timer);
          finish(exitCode);
        };

        channel.on('data', (chunk: Buffer) => {
          stdout += chunk.toString();
        });

        channel.stderr.on('data', (chunk: Buffer) => {
          stderr += chunk.toString();
        });

        // 避免 stderr 流未捕获的 error 抛进程异常；最终结果由 channel close/error 决定
        channel.stderr.on('error', () => {});

        // ssh2 在 close 事件首参给出退出码（信号退出时为 null）
        channel.on('close', (code: number | null) => {
          onClose(code);
        });

        channel.on('error', () => {
          onClose(null);
        });
      });
    });
  }
}
