/**
 * 轻应用路由 — 应用中心 CRUD + 运行时分发（后端 API 注入与前端静态托管）。
 *
 * - `/api/v1/apps*`：应用列表、安装、卸载、启停（写操作限管理员）
 * - `/api/apps/<id>/*`：把请求转发给应用自己的后端子 app
 * - `/app-static/<id>/*`：托管应用 vite 构建产物，供 App Center 内 iframe 使用
 */
import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Variables } from '../index.js';
import { getAuthContext, requireAdmin } from './helpers.js';
import { AppLoadError, getAppManager } from '../apps/app-manager.js';

/**
 * 注册轻应用相关路由。
 *
 * @param app vico 根 Hono 实例
 */
export function appRoutes(app: Hono<{ Variables: Variables }>) {
  /** 应用中心列表（含未安装应用） */
  app.get('/api/v1/apps', async (c) => {
    const auth = await getAuthContext(c);
    if (auth instanceof Response) return auth;
    return c.json(await getAppManager().list());
  });

  /** 单个应用摘要 */
  app.get('/api/v1/apps/:id', async (c) => {
    const auth = await getAuthContext(c);
    if (auth instanceof Response) return auth;

    const detail = await getAppManager().get(c.req.param('id'));
    if (!detail) return c.json({ error: 'App not found' }, 404);
    return c.json(detail);
  });

  /** 安装应用（管理员） */
  app.post('/api/v1/apps/:id/install', async (c) => {
    const auth = await requireAdmin(c);
    if (auth instanceof Response) return auth;

    try {
      return c.json(await getAppManager().install(c.req.param('id')));
    } catch (err) {
      if (err instanceof AppLoadError) return c.json({ error: err.message }, 400);
      throw err;
    }
  });

  /** 卸载应用（管理员） */
  app.post('/api/v1/apps/:id/uninstall', async (c) => {
    const auth = await requireAdmin(c);
    if (auth instanceof Response) return auth;

    await getAppManager().uninstall(c.req.param('id'));
    return c.json({ ok: true });
  });

  /** 启用应用（管理员） */
  app.post('/api/v1/apps/:id/enable', async (c) => {
    const auth = await requireAdmin(c);
    if (auth instanceof Response) return auth;

    try {
      return c.json(await getAppManager().setEnabled(c.req.param('id'), true));
    } catch (err) {
      if (err instanceof AppLoadError) return c.json({ error: err.message }, 400);
      throw err;
    }
  });

  /** 禁用应用（管理员） */
  app.post('/api/v1/apps/:id/disable', async (c) => {
    const auth = await requireAdmin(c);
    if (auth instanceof Response) return auth;

    try {
      return c.json(await getAppManager().setEnabled(c.req.param('id'), false));
    } catch (err) {
      if (err instanceof AppLoadError) return c.json({ error: err.message }, 400);
      throw err;
    }
  });

  /** 应用后端分发 — 安装且启用时把请求转给应用自己的 Hono 子 app */
  const dispatch = async (c: Context<{ Variables: Variables }>) => {
    const appId = c.req.param('appId')!;
    try {
      return await getAppManager().handleApi(appId, c.req.raw);
    } catch (err) {
      if (err instanceof AppLoadError) return c.json({ error: err.message }, 502);
      throw err;
    }
  };

  app.all('/api/apps/:appId', dispatch);
  app.all('/api/apps/:appId/*', dispatch);

  /** 应用前端入口补齐结尾斜杠，保证相对资源路径正确解析 */
  app.get('/app-static/:appId', async (c) => {
    const auth = await getAuthContext(c);
    if (auth instanceof Response) return auth;
    return c.redirect(`/app-static/${c.req.param('appId')}/`, 302);
  });

  /** 应用前端静态资源托管（session 鉴权） */
  app.get('/app-static/:appId/*', async (c) => {
    const auth = await getAuthContext(c);
    if (auth instanceof Response) return auth;
    return await getAppManager().serveStatic(c.req.param('appId')!, c.req.path);
  });
}
