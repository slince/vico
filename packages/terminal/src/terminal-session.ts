/**
 * 单个终端会话 — 维护 pty 进程与 headless 屏幕的保活生命周期。
 *
 * 一个会话（由 sessionKey 唯一标识）对应一个 pty 进程 + headless 屏幕 + 若干
 * follower 连接。进程生命周期与连接解耦：全部连接断开后启动空闲回收，新连接接入
 * 时回放当前屏幕快照，之后增量推送输出。sessionKey 的语义由调用方定义，本类不感知。
 */
import {homedir} from 'node:os';
import {createRequire} from 'node:module';

import {type IPty, spawn} from '@lydell/node-pty';
import type {Terminal as HeadlessTerminal} from '@xterm/headless';
import type {SerializeAddon as SerializeAddonType} from '@xterm/addon-serialize';

import type {Logger} from 'pino';

// @xterm/headless 与 @xterm/addon-serialize 是 CJS 模块且无 exports 字段，
// Node 的 ESM 命名导入无法静态识别其导出，运行时改用 createRequire 拿 CJS 对象
const require = createRequire(import.meta.url);
const {Terminal} = require('@xterm/headless') as typeof import('@xterm/headless');
const {SerializeAddon} = require('@xterm/addon-serialize') as typeof import('@xterm/addon-serialize');

/** 默认终端列数/行数（连接后由前端 resize 消息校准） */
const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;
/** 回放屏幕保留的最大滚动行数 */
const SCROLLBACK = 1000;
/** 无连接时进程保留时长（ms），超时回收避免泄漏 */
const IDLE_TIMEOUT_MS = 30 * 60 * 1000;

/** 单个 WebSocket 连接（follower），只暴露广播所需的最小能力 */
export interface TerminalFollower {
  send(data: string): void;
}

/** 服务端推送给前端的帧 */
export type TerminalFrame =
  | { type: 'snapshot'; data: string }
  | { type: 'output'; data: string }
  | { type: 'exit'; code: number };

/** attach 派生 shell 时的可选参数 */
export interface TerminalAttachOptions {
  /** shell 工作目录，缺省为进程 homedir */
  cwd?: string;
}

/**
 * 单个终端会话，持有 pty 进程 + headless 屏幕 + 若干 follower 连接。
 *
 * 由 `TerminalSessionManager` 创建并登记；调用方驱动 attach / handleMessage /
 * detach / destroy，不感知 pty / headless 细节。
 */
export class TerminalSession {
  constructor(
    private readonly key: string,
    private readonly logger: Logger,
    /** 会话终结后把自己从管理器注册表移除 */
    private readonly remove: () => void,
  ) {}

  private pty?: IPty;
  private screen?: HeadlessTerminal;
  private serializer?: SerializeAddonType;
  private readonly followers = new Set<TerminalFollower>();
  private idleTimer?: ReturnType<typeof setTimeout>;
  /** 是否已销毁（dispose 幂等 + 阻止退出回调二次广播） */
  private disposed = false;

  /**
   * 连接建立。已有进程则复用并回放当前屏幕；否则派生 shell 并回放空屏。
   * spawn 失败返回 false（调用方应关闭连接）。
   */
  attach(follower: TerminalFollower, options: TerminalAttachOptions = {}): boolean {
    if (this.disposed) return false;

    // 保活命中：进程仍在，复用会话并回放当前屏幕
    if (this.pty && this.screen && this.serializer) {
      this.followers.add(follower);
      clearTimeout(this.idleTimer);
      this.send(follower, { type: 'snapshot', data: this.serializer.serialize() });
      return true;
    }

    const shell = process.env.SHELL || '/bin/bash';
    const cwd = options.cwd || homedir();

    let pty: IPty;
    try {
      pty = spawn(shell, [], {
        name: 'xterm-256color',
        cols: DEFAULT_COLS,
        rows: DEFAULT_ROWS,
        cwd,
        env: process.env as Record<string, string>,
      });
    } catch (err) {
      this.logger.error({ err, key: this.key }, 'Failed to spawn terminal');
      return false;
    }

    // headless 屏幕是会话内容的真身，serializer 负责在重连时序列化完整屏幕
    const screen = new Terminal({
      cols: DEFAULT_COLS,
      rows: DEFAULT_ROWS,
      scrollback: SCROLLBACK,
      // SerializeAddon.serialize() 需读取 terminal.buffer（proposed API），必须显式启用
      allowProposedApi: true,
    });
    const serializer = new SerializeAddon();
    screen.loadAddon(serializer);

    this.pty = pty;
    this.screen = screen;
    this.serializer = serializer;
    this.followers.add(follower);

    // pty 输出先写入 headless 屏幕（供重连回放），再增量推给所有连接
    pty.onData((data) => {
      screen.write(data);
      this.broadcast({ type: 'output', data });
    });
    pty.onExit(({ exitCode }) => {
      // 已被显式 destroy 时不再二次广播 / 清理
      if (this.disposed) return;
      this.broadcast({ type: 'exit', code: exitCode });
      this.dispose();
    });

    this.send(follower, { type: 'snapshot', data: serializer.serialize() });
    return true;
  }

  /** 接收消息：resize JSON 或原始输入 */
  handleMessage(data: string): void {
    if (this.disposed || !this.pty || !this.screen) return;
    try {
      const msg = JSON.parse(data) as { type?: string; cols?: number; rows?: number };
      if (msg?.type === 'resize' && typeof msg.cols === 'number' && typeof msg.rows === 'number') {
        try {
          this.pty.resize(msg.cols, msg.rows);
        } catch (err) {
          this.logger.warn({ err, key: this.key, cols: msg.cols, rows: msg.rows }, 'Failed to resize terminal');
        }
        this.screen.resize(msg.cols, msg.rows);
        return;
      }
    } catch { /* 非 JSON，按原始输入处理 */ }
    this.pty.write(data);
  }

  /** 连接关闭：仅移除该连接，不终止进程（保活），无连接后启动空闲回收 */
  detach(follower: TerminalFollower): void {
    this.followers.delete(follower);
    if (this.followers.size === 0) this.scheduleIdleReclaim();
  }

  /** 显式销毁会话：通知 follower 退出、终止进程并释放资源 */
  destroy(): void {
    if (this.disposed) return;
    // 显式销毁没有真实退出码，约定 code 0 表示被管理器终止
    this.broadcast({ type: 'exit', code: 0 });
    const pty = this.pty;
    this.dispose();
    try {
      pty?.kill();
    } catch (err) {
      this.logger.warn({ err, key: this.key }, 'Failed to kill terminal pty');
    }
  }

  /** 向单个连接发送一帧（socket 已关闭时告警） */
  private send(follower: TerminalFollower, frame: TerminalFrame): void {
    try {
      follower.send(JSON.stringify(frame));
    } catch (err) {
      this.logger.warn({ err, frame: frame.type }, 'Failed to send terminal frame');
    }
  }

  /** 向会话的所有连接广播一帧 */
  private broadcast(frame: TerminalFrame): void {
    for (const follower of this.followers) this.send(follower, frame);
  }

  /** 无连接后启动空闲回收定时器，超时 kill 进程并清理会话 */
  private scheduleIdleReclaim(): void {
    clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      if (this.followers.size > 0 || this.disposed) return;
      const pty = this.pty;
      try {
        pty?.kill();
      } catch (err) {
        this.logger.warn({ err, key: this.key }, 'Failed to kill terminal pty');
      }
      this.dispose();
    }, IDLE_TIMEOUT_MS);
  }

  /** 释放会话资源（销毁屏幕、清空状态），并把自己从管理器移除；幂等 */
  private dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    clearTimeout(this.idleTimer);
    this.screen?.dispose();
    this.pty = undefined;
    this.screen = undefined;
    this.serializer = undefined;
    this.followers.clear();
    this.remove();
  }
}
