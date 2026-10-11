import { Hono } from 'hono';
import type { UpgradeWebSocket } from 'hono/ws';

import type { Variables } from '../../index.js';
import { terminalRoutes } from './terminal.js';

/**
 * 注册所有 WebSocket 路由。
 *
 * WebSocket 路由需要 `upgradeWebSocket`（由 @hono/node-server 提供），故不走
 * `api/router.ts` 的 registerRoutes，而由 `vico.ts` 单独调用本函数统一注册。
 *
 * @param app - Hono 应用实例
 * @param upgradeWebSocket - @hono/node-server 提供的升级助手
 */
export function registerWsRoutes(
  app: Hono<{ Variables: Variables }>,
  upgradeWebSocket: UpgradeWebSocket,
) {
  terminalRoutes(app, upgradeWebSocket);
}
