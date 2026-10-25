// @vico/bash-ssh - ssh2 最小类型声明
//
// ssh2@1.17.0 未随附 TypeScript 类型（package.json 无 types/typings 字段），
// 此处按实际用到的 Client / ClientChannel / ConnectConfig 补最小局部声明，
// 不引入 @types/ssh2。

declare module 'ssh2' {
  /** 建立 SSH 连接所需的配置（与 SshConnectionOptions 对齐）。 */
  export interface ConnectConfig {
    host: string;
    port?: number;
    username?: string;
    password?: string;
    privateKey?: string | Buffer;
    passphrase?: string;
  }

  /** client.exec 成功回调得到的远端通道（stdout 侧）。 */
  export interface ClientChannel {
    /** 远端 stderr 流 */
    stderr: ClientStderr;
    /** 关闭通道，触发远端 close（超时中断用） */
    close(): boolean;
    on(event: 'data', listener: (chunk: Buffer) => void): this;
    on(event: 'close', listener: (code: number | null, signal?: string | null) => void): this;
    on(event: 'error', listener: (err: Error) => void): this;
  }

  /** 远端 stderr 流的最小形状。 */
  export interface ClientStderr {
    on(event: 'data', listener: (chunk: Buffer) => void): this;
    on(event: 'error', listener: (err: Error) => void): this;
  }

  /** client.exec 的可选参数。 */
  export interface ExecOptions {
    env?: Record<string, string>;
  }

  /** SSH 客户端连接。 */
  export class Client {
    connect(config: ConnectConfig): this;
    exec(command: string, callback: (err: Error | undefined, channel: ClientChannel) => void): boolean;
    exec(command: string, options: ExecOptions, callback: (err: Error | undefined, channel: ClientChannel) => void): boolean;
    end(): this;
    on(event: 'ready', listener: () => void): this;
    on(event: 'error', listener: (err: Error) => void): this;
    on(event: 'close', listener: () => void): this;
    once(event: 'ready', listener: () => void): this;
  }
}
