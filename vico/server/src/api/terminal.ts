/**
 * Web 终端 API — 基于 xterm + pty 的线程工作目录终端。
 *
 * 通过 WebSocket（@hono/node-ws 的 upgradeWebSocket）建立连接，服务端用
 * node-pty 派生一个 shell（cwd = 线程 workspace），把 pty 输出转发给前端，
 * 把前端输入写入 pty；resize 通过 JSON 消息 `{"type":"resize",cols,rows}` 控制。
 * 每个 thread 同一时刻只保留一个 pty，重复连接时旧的会被 kill。
 */
import { Hono } from 'hono';
import type { NodeWebSocket } from '@hono/node-ws';
import { spawn, type IPty } from '@lydell/node-pty';
import { homedir } from 'node:os';

import type { Variables } from '../index.js';
import { getThreadWorkspace } from '../lib/workspace.js';
import logger from '../lib/logger.js';

/** 默认终端列数/行数（连接后由前端 resize 消息校准） */
const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;

/** createNodeWebSocket 返回的 upgradeWebSocket 类型 */
type UpgradeWebSocketFn = NodeWebSocket['upgradeWebSocket'];

/**
 * 注册终端 WebSocket 路由。
 *
 * 终端路由需要 `upgradeWebSocket`（由 createNodeWebSocket 产生），故不在
 * `api/router.ts` 的 registerRoutes 中注册，而由 `vico.ts` 单独调用。
 *
 * @param app - Hono 应用实例
 * @param upgradeWebSocket - createNodeWebSocket 返回的升级助手
 */
export function terminalRoutes(
  app: Hono<{ Variables: Variables }>,
  upgradeWebSocket: UpgradeWebSocketFn,
) {
  // threadId -> 活跃 pty，保证每线程单会话
  const sessions = new Map<string, IPty>();

  app.get(
    '/api/v1/threads/:threadId/terminal',
    upgradeWebSocket((c) => {
      const threadId = c.req.param('threadId');
      // 路由模式保证 :threadId 存在，类型上仍可能 undefined，兜底直接关闭连接
      if (!threadId) {
        return {
          onOpen(_evt, ws) {
            ws.close();
          },
        };
      }

      return {
        /** 连接建立：解析 workspace 并派生 shell */
        async onOpen(_evt, ws) {
          // 同线程重复连接时先回收旧 pty，避免泄漏
          const existing = sessions.get(threadId);
          if (existing) {
            try {
              existing.kill();
            } catch { /* ignore */ }
            sessions.delete(threadId);
          }

          const workspace = await getThreadWorkspace(threadId);
          const cwd = workspace || homedir();
          const shell = process.env.SHELL || '/bin/bash';

          let term: IPty;
          try {
            term = spawn(shell, [], {
              name: 'xterm-256color',
              cols: DEFAULT_COLS,
              rows: DEFAULT_ROWS,
              cwd,
              env: process.env as Record<string, string>,
            });
          } catch (err) {
            logger.error({ err, threadId }, 'Failed to spawn terminal');
            ws.close();
            return;
          }

          sessions.set(threadId, term);

          term.onData((data) => {
            try {
              ws.send(data);
            } catch { /* socket 已关闭 */ }
          });
          term.onExit(() => {
            sessions.delete(threadId);
            try {
              ws.close();
            } catch { /* ignore */ }
          });
        },

        /** 接收消息：resize JSON 或原始输入 */
        onMessage(evt) {
          const term = sessions.get(threadId);
          if (!term) return;
          const data = String(evt.data);
          try {
            const msg = JSON.parse(data) as { type?: string; cols?: number; rows?: number };
            if (msg?.type === 'resize' && typeof msg.cols === 'number' && typeof msg.rows === 'number') {
              term.resize(msg.cols, msg.rows);
              return;
            }
          } catch { /* 非 JSON，按原始输入处理 */ }
          term.write(data);
        },

        /** 连接关闭：回收 pty */
        onClose() {
          const term = sessions.get(threadId);
          if (term) {
            try {
              term.kill();
            } catch { /* ignore */ }
            sessions.delete(threadId);
          }
        },
      };
    }),
  );
}
