import {Hono} from 'hono';
import type {Variables} from '../index.js';
import {getAuthContext} from './helpers.js';
import {meta, providers} from '../llm/providers/index.js';

/**
 * LLM 厂商目录路由 — 向前端暴露内置支持的大模型服务商清单。
 * 数据来自 llm/providers/*.json（按厂商拆分），随服务端打包静态导入。
 */
export function providerRoutes(app: Hono<{ Variables: Variables }>) {
  /** 查询内置支持的大模型服务商 */
  app.get('/api/v1/llm-providers', async (c) => {
    const auth = await getAuthContext(c);
    if (auth instanceof Response) return auth;
    return c.json({ meta, providers });
  });
}
