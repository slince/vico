/**
 * 终端会话管理器 — 维护 pty 进程与 headless 屏幕的保活生命周期。
 *
 * 一个终端会话（`${threadId}:${terminalId}`）对应一个 pty 进程 + headless 屏幕 +
 * 若干 follower 连接。进程独立于 WebSocket 连接存活：断开后空闲超时才回收，
 * 新连接接入时回放当前屏幕快照，之后增量推送输出。路由层只做参数提取，
 * 全部会话维护逻辑收敛于此。
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

/** 一个保活的终端会话：pty 进程 + headless 屏幕 + 若干连接 */
interface TerminalSession {
  pty: IPty;
  screen: HeadlessTerminal;
  serializer: SerializeAddonType;
  followers: Set<TerminalFollower>;
  idleTimer?: ReturnType<typeof setTimeout>;
}

/** 会话 key：`${threadId}:${terminalId}` -> 活跃会话 */
function sessionKey(threadId: string, terminalId: string): string {
  return `${threadId}:${terminalId}`;
}

/**
 * 终端会话管理器（模块级单例）。
 *
 * 负责终端进程的创建、复用、输入转发、断开回收与屏幕回放。路由层通过
 * attach / handleMessage / detach 三个方法驱动，不感知 pty / headless 细节。
 */
export class TerminalManager {
  constructor(
    private readonly resolveWorkspace: (threadId: string) => Promise<string>,
    private readonly logger: Logger,
  ) {}

  private sessions = new Map<string, TerminalSession>();

  /**
   * 连接建立。已有会话则复用并回放当前屏幕；否则派生 shell 并回放空屏。
   * spawn 失败返回 false（调用方应关闭连接）。
   */
  async attach(threadId: string, terminalId: string, follower: TerminalFollower): Promise<boolean> {
    const key = sessionKey(threadId, terminalId);

    // 保活命中：进程仍在，复用会话并回放当前屏幕
    const existing = this.sessions.get(key);
    if (existing) {
      existing.followers.add(follower);
      clearTimeout(existing.idleTimer);
      this.send(follower, { type: 'snapshot', data: existing.serializer.serialize() });
      return true;
    }

    // 派生 shell（cwd = 线程 workspace），失败则告知调用方关闭连接
    const workspace = await this.resolveWorkspace(threadId);
    const cwd = workspace || homedir();
    const shell = process.env.SHELL || '/bin/bash';

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
      this.logger.error({ err, threadId, terminalId }, 'Failed to spawn terminal');
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

    const session: TerminalSession = {
      pty,
      screen,
      serializer,
      followers: new Set([follower]),
    };
    this.sessions.set(key, session);

    // pty 输出先写入 headless 屏幕（供重连回放），再增量推给所有连接
    pty.onData((data) => {
      screen.write(data);
      this.broadcast(session, { type: 'output', data });
    });
    pty.onExit(({ exitCode }) => {
      this.broadcast(session, { type: 'exit', code: exitCode });
      this.sessions.delete(key);
      clearTimeout(session.idleTimer);
      screen.dispose();
    });

    this.send(follower, { type: 'snapshot', data: serializer.serialize() });
    return true;
  }

  /** 接收消息：resize JSON 或原始输入 */
  handleMessage(threadId: string, terminalId: string, data: string): void {
    const session = this.sessions.get(sessionKey(threadId, terminalId));
    if (!session) return;
    try {
      const msg = JSON.parse(data) as { type?: string; cols?: number; rows?: number };
      if (msg?.type === 'resize' && typeof msg.cols === 'number' && typeof msg.rows === 'number') {
        try {
          session.pty.resize(msg.cols, msg.rows);
        } catch (err) {
          this.logger.warn({ err, threadId, terminalId, cols: msg.cols, rows: msg.rows }, 'Failed to resize terminal');
        }
        session.screen.resize(msg.cols, msg.rows);
        return;
      }
    } catch { /* 非 JSON，按原始输入处理 */ }
    session.pty.write(data);
  }

  /** 连接关闭：仅移除该连接，不终止进程（保活），无连接后启动空闲回收 */
  detach(threadId: string, terminalId: string, follower: TerminalFollower): void {
    const key = sessionKey(threadId, terminalId);
    const session = this.sessions.get(key);
    if (!session) return;
    session.followers.delete(follower);
    if (session.followers.size === 0) this.scheduleIdleReclaim(session, key);
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
  private broadcast(session: TerminalSession, frame: TerminalFrame): void {
    for (const follower of session.followers) this.send(follower, frame);
  }

  /** 无连接后启动空闲回收定时器，超时 kill 进程并清理会话 */
  private scheduleIdleReclaim(session: TerminalSession, key: string): void {
    clearTimeout(session.idleTimer);
    session.idleTimer = setTimeout(() => {
      if (session.followers.size > 0) return;
      this.sessions.delete(key);
      try {
        session.pty.kill();
      } catch (err) {
        this.logger.warn({ err, key }, 'Failed to kill terminal pty');
      }
      session.screen.dispose();
    }, IDLE_TIMEOUT_MS);
  }
}
