import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, dirname } from 'node:path';
import {Mastra} from '@mastra/core';
import {PinoLogger} from '@mastra/loggers';
import {MastraServer} from '@mastra/hono';
import {mainAgent} from './agent/agents/main.agent.js';
import {agentProxy} from './agent/agents/agent-proxy.agent.js';
import {getMemory, getStorage} from './agent/memory-setup.js';
import {getObservabilityConfig} from './agent/observability/config.js';
import {createApp} from './app.js';
import type { Hono } from 'hono';
import type { Variables } from './index.js';
import logger from './lib/logger.js';

/**
 * Mastra 实例 — 全局单例。
 *
 * 预注册两个 Agent：
 * - mainAgent: 通用任务路由调度，负责分析意图并分派给专业 Agent
 * - agentProxy: 配置驱动的 Agent 代理模板，运行时通过 RunContext 动态注入配置
 *
 * 使用 LibSQLStore 作为持久化存储后端，为 Memory 的消息存储与召回提供支持。
 * 同时启用 Observability 观测性配置，通过 MastraStorageExporter 将遥测数据
 * 自动写入同一 LibSQL 存储后端。
 */
export const mastra = new Mastra({
  agents: {
    mainAgent,
    agentProxy,
  },
  storage: await getStorage(),
  logger: new PinoLogger({
    name: 'Vico',
    level: 'info',
  }),
  memory: {
    memory: await getMemory(),
  },
  observability: getObservabilityConfig(),
});

/** 预编译的 index.html 内容（替换模板变量后） */
let compiledIndexHtml: string | null = null;

/** 创建 Hono app 实例，包含所有现有中间件和路由 */
export const app = createApp();

/**
 * MastraServer — @mastra/hono 集成适配器。
 *
 * 负责：
 * - 注入 Mastra Context 中间件（RequestContext + ToolsInput + AbortSignal 注入到 Hono context）
 * - 自动注册 Agent 流式端点（/api/mastra/agents/:id/chat 等内建路由）
 * - 注册自定义 API 路由（若通过 registerApiRoute() 定义）
 * - 流式响应处理（SSE 格式）
 *
 * MastraServer 构造函数接收 `app` 作为必需参数，内部通过
 * `mastra.setMastraServer(this)` 将自身注册到 Mastra 实例。
 *
 * `init()` 按顺序执行：context 中间件 → auth 中间件 → 日志中间件 →
 * EE 许可证校验（无 RBAC/FGA 配置时跳过）→ 自定义路由 → 内建路由。
 */
export const server = new MastraServer({ app, mastra });

// 初始化 MastraServer：注册所有中间件和路由
await server.init();

// 在 MastraServer 路由注册完成后挂载 Studio UI（确保不与内建路由冲突）
serveStudioUI(app);

export default mastra;

// ---- Studio UI 静态资源服务 ----

/** 解析 mastra CLI 包中的 Studio 构建产物目录 */
function getStudioDir(): string | null {
  try {
    const require = createRequire(import.meta.url);
    const pkgPath = require.resolve('mastra/package.json');
    const dir = join(dirname(pkgPath), 'dist', 'studio');
    if (existsSync(join(dir, 'index.html'))) return dir;
    return null;
  } catch {
    return null;
  }
}

/** 将 Studio UI 挂载到 Hono app */
function serveStudioUI(app: Hono<{ Variables: Variables }>) {
  const studioDir = getStudioDir();
  if (!studioDir) {
    logger.warn('Mastra Studio UI not found — skipping Studio mount');
    return;
  }

  // 编译 index.html，替换 mastra dev 模板变量
  if (!compiledIndexHtml) {
    compiledIndexHtml = readFileSync(join(studioDir, 'index.html'), 'utf-8')
      .replaceAll('%%MASTRA_STUDIO_BASE_PATH%%', '/studio')
      .replaceAll('%%MASTRA_API_PREFIX%%', '/api')
      .replaceAll('%%MASTRA_SERVER_HOST%%', '')
      .replaceAll('%%MASTRA_SERVER_PORT%%', '')
      .replaceAll('%%MASTRA_TELEMETRY_DISABLED%%', 'true')
      .replaceAll('%%MASTRA_HIDE_CLOUD_CTA%%', 'true')
      .replaceAll('%%MASTRA_SERVER_PROTOCOL%%', '')
      .replaceAll('%%MASTRA_CLOUD_API_ENDPOINT%%', '')
      .replaceAll('%%MASTRA_EXPERIMENTAL_FEATURES%%', '')
      .replaceAll('%%MASTRA_TEMPLATES%%', '')
      .replaceAll('%%MASTRA_AUTO_DETECT_URL%%', 'true')
      .replaceAll('%%MASTRA_REQUEST_CONTEXT_PRESETS%%', '')
      .replaceAll('%%MASTRA_EXPERIMENTAL_UI%%', '')
      .replaceAll('%%MASTRA_AGENT_SIGNALS%%', '');
  }

  // /studio → /studio/
  app.get('/studio', (c) => c.redirect('/studio/'));

  // SPA 入口
  app.get('/studio/', (c) => c.html(compiledIndexHtml!));
  app.get('/studio/index.html', (c) => c.html(compiledIndexHtml!));

  // mastra.svg favicon
  app.get('/studio/mastra.svg', (c) => {
    c.header('Content-Type', 'image/svg+xml');
    return c.body(readFileSync(join(studioDir, 'mastra.svg'), 'utf-8'));
  });

  // 静态资源（JS / CSS / 字体）
  const contentTypes: Record<string, string> = {
    '.js': 'application/javascript',
    '.mjs': 'application/javascript',
    '.css': 'text/css',
    '.woff2': 'font/woff2',
    '.ttf': 'font/ttf',
    '.svg': 'image/svg+xml',
    '.json': 'application/json',
  };

  app.get('/studio/assets/:filename{.+}', (c) => {
    const filename = c.req.param('filename');
    // 防止路径穿越
    if (filename.includes('..')) return c.text('Forbidden', 403);
    const filePath = join(studioDir, 'assets', filename);
    if (!existsSync(filePath)) return c.text('Not Found', 404);

    const ext = filename.match(/\.[a-z0-9]+$/i)?.[0]?.toLowerCase();
    const ct = contentTypes[ext ?? ''] ?? 'application/octet-stream';
    c.header('Content-Type', ct);
    c.header('Cache-Control', 'public, max-age=31536000, immutable');
    return c.body(readFileSync(filePath));
  });

  // SSE 热重载事件端点 — 开发环境下通知前端刷新
  app.get('/studio/refresh-events', (c) => {
    const stream = new ReadableStream({
      start(controller) {
        const keepAlive = setInterval(() => {
          try {
            controller.enqueue(new TextEncoder().encode(': keepalive\n\n'));
          } catch {
            clearInterval(keepAlive);
          }
        }, 15_000);

        c.req.raw.signal.addEventListener('abort', () => {
          clearInterval(keepAlive);
          try { controller.close(); } catch { /* ignore */ }
        });
      },
    });

    c.header('Content-Type', 'text/event-stream');
    c.header('Cache-Control', 'no-cache');
    c.header('Connection', 'keep-alive');
    return c.body(stream);
  });

  logger.info({ path: '/studio/' }, 'Mastra Studio UI mounted');
}
