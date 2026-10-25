/**
 * 终端控制面 API — 与 WebSocket 数据面（ws/terminal.ts）配套的 REST 端点。
 *
 * 负责显式关闭终端会话（销毁 pty 与 headless 屏幕），是 TerminalSessionManager
 * getSession / destroySession 的调用方；数据面（连接建立、输入、断开）仍走 WebSocket。
 */
import { Hono } from 'hono';

import type { Variables } from '../index.js';
import { getAuthContext } from './helpers.js';
import { getContainer } from '../container.js';

export function terminalRoutes(app: Hono<{ Variables: Variables }>) {
  /** DELETE /api/v1/threads/:threadId/terminal/:terminalId — 关闭终端会话 */
  app.delete('/api/v1/threads/:threadId/terminal/:terminalId', async (c) => {
    const auth = await getAuthContext(c);
    if (auth instanceof Response) return auth;

    const threadId = c.req.param('threadId');
    const terminalId = c.req.param('terminalId');

    const sessionManager = getContainer().get('terminalSessionManager');
    // sessionKey 与 WS 数据面保持一致，由调用方拼接
    const key = `${threadId}:${terminalId}`;

    if (!sessionManager.getSession(key)) {
      return c.json({ error: 'Terminal session not found' }, 404);
    }
    sessionManager.destroySession(key);
    return c.json({ closed: true });
  });
}
