/**
 * Web 终端 API — 基于 xterm(headless) + pty 的线程工作目录终端。
 *
 * 通过 WebSocket（@hono/node-server 的 upgradeWebSocket + ws）建立连接，服务端用
 * node-pty 派生一个 shell（cwd = 线程 workspace），把 pty 输出转发给前端，
 * 把前端输入写入 pty；resize 通过 JSON 消息 `{"type":"resize",cols,rows}` 控制。
 *
 * 与「连接即进程」的旧版不同，本版实现 **shell 保活**：pty 进程独立于
 * WebSocket 连接。服务端用 @xterm/headless 维护每个终端的屏幕，连接断开时
 * 进程继续运行（空闲超时后才回收）；新连接接入时用 @xterm/addon-serialize
 * 序列化当前屏幕作为 `snapshot` 帧回放，之后增量输出以 `output` 帧推送。
 * 这样前端断线重连（含 React StrictMode 双挂载）不会丢失 shell 会话。
 *
 * 一个线程可同时存在多个终端，每个终端由前端生成的 `terminalId` 区分，
 * 会话按 `${threadId}:${terminalId}` 粒度保存。
 */
import { Hono } from 'hono';
import type { UpgradeWebSocket } from 'hono/ws';
import { spawn, type IPty } from '@lydell/node-pty';
import { Terminal as HeadlessTerminal } from '@xterm/headless';
import { SerializeAddon } from '@xterm/addon-serialize';
import { homedir } from 'node:os';

import type { Variables } from '../index.js';
import { getThreadWorkspace } from '../lib/workspace.js';
import logger from '../lib/logger.js';

/** 默认终端列数/行数（连接后由前端 resize 消息校准） */
const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;
/** 回放屏幕保留的最大滚动行数 */
const SCROLLBACK = 1000;
/** 无连接时进程保留时长（ms），超时回收避免泄漏 */
const IDLE_TIMEOUT_MS = 30 * 60 * 1000;

/** upgradeWebSocket 助手类型（@hono/node-server 导出，底层为 hono/ws 的 UpgradeWebSocket） */
type UpgradeWebSocketFn = UpgradeWebSocket;
/** 单个 WebSocket 连接（follower），只暴露广播所需的最小能力 */
interface Follower {
  send(data: string): void;
}

/** 服务端推送给前端的帧 */
type TerminalFrame =
  | { type: 'snapshot'; data: string }
  | { type: 'output'; data: string }
  | { type: 'exit'; code: number };

/** 一个保活的终端会话：pty 进程 + headless 屏幕 + 若干连接 */
interface TerminalSession {
  pty: IPty;
  screen: HeadlessTerminal;
  serializer: SerializeAddon;
  followers: Set<Follower>;
  idleTimer?: ReturnType<typeof setTimeout>;
}

/** 会话 key：`${threadId}:${terminalId}` -> 活跃会话 */
function sessionKey(threadId: string, terminalId: string): string {
  return `${threadId}:${terminalId}`;
}

/**
 * 注册终端 WebSocket 路由。
 *
 * 终端路由需要 `upgradeWebSocket`（由 @hono/node-server 提供），故不在
 * `api/router.ts` 的 registerRoutes 中注册，而由 `vico.ts` 单独调用。
 *
 * @param app - Hono 应用实例
 * @param upgradeWebSocket - @hono/node-server 提供的升级助手
 */
export function terminalRoutes(
  app: Hono<{ Variables: Variables }>,
  upgradeWebSocket: UpgradeWebSocketFn,
) {
  // 会话 Map：`threadId:terminalId` -> 保活的终端会话
  const sessions = new Map<string, TerminalSession>();

  app.get(
    '/api/v1/threads/:threadId/terminal/:terminalId',
    upgradeWebSocket((c) => {
      const threadId = c.req.param('threadId');
      const terminalId = c.req.param('terminalId');
      // 路由模式保证参数存在，类型上仍可能 undefined，兜底直接关闭连接
      if (!threadId || !terminalId) {
        return {
          onOpen(_evt, ws) {
            ws.close();
          },
        };
      }

      const key = sessionKey(threadId, terminalId);

      /** 向会话的所有连接广播一帧 */
      const broadcast = (session: TerminalSession, frame: TerminalFrame) => {
        const payload = JSON.stringify(frame);
        for (const follower of session.followers) {
          try {
            follower.send(payload);
          } catch { /* socket 已关闭 */ }
        }
      };

      /** 无连接后启动空闲回收定时器，超时 kill 进程并清理会话 */
      const scheduleIdleReclaim = (session: TerminalSession) => {
        clearTimeout(session.idleTimer);
        session.idleTimer = setTimeout(() => {
          if (session.followers.size > 0) return;
          sessions.delete(key);
          try {
            session.pty.kill();
          } catch { /* ignore */ }
          session.screen.dispose();
        }, IDLE_TIMEOUT_MS);
      };

      return {
        /** 连接建立：已有会话则 attach + 回放屏幕，否则派生 shell */
        async onOpen(_evt, ws) {
          // 保活命中：进程仍在，直接复用会话并回放当前屏幕
          const existing = sessions.get(key);
          if (existing) {
            existing.followers.add(ws);
            clearTimeout(existing.idleTimer);
            try {
              ws.send(JSON.stringify({ type: 'snapshot', data: existing.serializer.serialize() }));
            } catch { /* ignore */ }
            return;
          }

          const workspace = await getThreadWorkspace(threadId);
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
            logger.error({ err, threadId, terminalId }, 'Failed to spawn terminal');
            ws.close();
            return;
          }

          // headless 屏幕是会话内容的真身，serializer 负责在重连时序列化完整屏幕
          const screen = new HeadlessTerminal({
            cols: DEFAULT_COLS,
            rows: DEFAULT_ROWS,
            scrollback: SCROLLBACK,
          });
          const serializer = new SerializeAddon();
          screen.loadAddon(serializer);

          const session: TerminalSession = {
            pty,
            screen,
            serializer,
            followers: new Set([ws]),
          };
          sessions.set(key, session);

          // pty 输出先写入 headless 屏幕（供重连回放），再增量推给所有连接
          pty.onData((data) => {
            screen.write(data);
            broadcast(session, { type: 'output', data });
          });
          pty.onExit(({ exitCode }) => {
            broadcast(session, { type: 'exit', code: exitCode });
            sessions.delete(key);
            clearTimeout(session.idleTimer);
            screen.dispose();
          });

          try {
            ws.send(JSON.stringify({ type: 'snapshot', data: serializer.serialize() }));
          } catch { /* ignore */ }
        },

        /** 接收消息：resize JSON 或原始输入 */
        onMessage(evt) {
          const session = sessions.get(key);
          if (!session) return;
          const data = String(evt.data);
          try {
            const msg = JSON.parse(data) as { type?: string; cols?: number; rows?: number };
            if (msg?.type === 'resize' && typeof msg.cols === 'number' && typeof msg.rows === 'number') {
              try {
                session.pty.resize(msg.cols, msg.rows);
              } catch { /* ignore */ }
              session.screen.resize(msg.cols, msg.rows);
              return;
            }
          } catch { /* 非 JSON，按原始输入处理 */ }
          session.pty.write(data);
        },

        /** 连接关闭：仅移除该连接，不终止进程（保活） */
        onClose(_evt, ws) {
          const session = sessions.get(key);
          if (!session) return;
          session.followers.delete(ws);
          if (session.followers.size === 0) scheduleIdleReclaim(session);
        },
      };
    }),
  );
}
