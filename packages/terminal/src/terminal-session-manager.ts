/**
 * 终端会话管理器 — 按 sessionKey 维护会话注册表。
 *
 * 只认不透明的 sessionKey（由调用方拼接，如 `${threadId}:${terminalId}`），
 * 不感知 thread / terminal 等上层领域概念。通过 createSession / getSession /
 * destroySession 管理会话生命周期，具体会话行为见 `TerminalSession`。
 */
import type {Logger} from 'pino';

import {TerminalSession} from './terminal-session.js';

/**
 * 终端会话管理器（模块级单例）。
 *
 * 只按不透明的 sessionKey 维护会话注册表；key 的语义（线程/终端等）完全交给调用方。
 * 通过 createSession / getSession / destroySession 管理会话生命周期。
 */
export class TerminalSessionManager {
  constructor(private readonly logger: Logger) {}

  private readonly sessions = new Map<string, TerminalSession>();

  /** 创建会话（已存在则返回既有句柄，幂等） */
  createSession(sessionKey: string): TerminalSession {
    const existing = this.sessions.get(sessionKey);
    if (existing) return existing;

    const session = new TerminalSession(sessionKey, this.logger, () => this.sessions.delete(sessionKey));
    this.sessions.set(sessionKey, session);
    return session;
  }

  /** 获取已存在的会话，不存在返回 undefined */
  getSession(sessionKey: string): TerminalSession | undefined {
    return this.sessions.get(sessionKey);
  }

  /** 销毁会话：终止进程、释放资源并从注册表移除 */
  destroySession(sessionKey: string): void {
    this.sessions.get(sessionKey)?.destroy();
  }
}
