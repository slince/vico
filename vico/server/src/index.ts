import {serve} from '@hono/node-server';
import {config} from './config.js';
import {bootstrap} from './bootstrap.js';
import {app} from './vico.js';
import {wss} from './app.js';
import {auth} from './auth';
import logger from './lib/logger.js';

/** Hono 上下文变量类型 */
export type Variables = {
  user: typeof auth.$Infer.Session.user | null;
  session: typeof auth.$Infer.Session.session | null;
};

async function main() {
  // 装配 framework 依赖（boot）+ 应用层初始化（迁移/seed/建表/清理定时器）
  await bootstrap();

  // websocket.server 注入 wss：@hono/node-server 在 HTTP upgrade 时把连接交给 WebSocketServer 处理
  serve({
    fetch: app.fetch,
    port: config.server.port,
    hostname: '0.0.0.0',
    websocket: { server: wss }
  }, (info) => {
    logger.info({ port: info.port, deployMode: config.server.deploy_mode }, 'Server started');
  });
}

main().catch((err) => {
  logger.fatal({ err }, 'Server failed to start');
  process.exit(1);
});
