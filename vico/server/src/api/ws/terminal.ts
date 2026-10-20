/**
 * Web 终端 API — 基于 xterm(headless) + pty 的线程工作目录终端。
 *
 * 通过 WebSocket（@hono/node-server 的 upgradeWebSocket + ws）建立连接。
 * 会话维护（pty 保活、屏幕回放、空闲回收）收敛在 lib/terminal-manager.ts，
 * 本文件只做路由注册与参数提取，把连接事件转发给终端管理器。
 */
import { Hono } from 'hono';
import type { UpgradeWebSocket } from 'hono/ws';

import type { Variables } from '../../index.js';
import { getContainer } from '../../container.js';

/** upgradeWebSocket 助手类型（@hono/node-server 导出，底层为 hono/ws 的 UpgradeWebSocket） */
type UpgradeWebSocketFn = UpgradeWebSocket;

/**
 * 注册终端 WebSocket 路由。
 *
 * 终端路由需要 `upgradeWebSocket`（由 @hono/node-server 提供），故不在
 * `api/router.ts` 的 registerRoutes 中注册，而由 `app.ts` 的 createApp 调用。
 *
 * @param app - Hono 应用实例
 * @param upgradeWebSocket - @hono/node-server 提供的升级助手
 */
export function terminalRoutes(
  app: Hono<{ Variables: Variables }>,
  upgradeWebSocket: UpgradeWebSocketFn,
) {
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

      const terminalManager = getContainer().get('terminalManager');

      return {
        /** 连接建立：复用会话并回放屏幕，或派生 shell；spawn 失败则关闭 */
        async onOpen(_evt, ws) {
          const ok = await terminalManager.attach(threadId, terminalId, ws);
          if (!ok) ws.close();
        },

        /** 接收消息：resize JSON 或原始输入，交给会话管理器处理 */
        onMessage(evt) {
          terminalManager.handleMessage(threadId, terminalId, String(evt.data));
        },

        /** 连接关闭：仅移除该连接，不终止进程（保活） */
        onClose(_evt, ws) {
          terminalManager.detach(threadId, terminalId, ws);
        },
      };
    }),
  );
}
