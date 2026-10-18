import {serve} from '@hono/node-server';
import {bootstrap} from './bootstrap.js';
import {app, wss} from './app.js';
import {getContainer} from './container.js';
import logger from './lib/logger.js';

// better-auth 会话用户/会话对象（getAuth 返回 any，类型随 auth 实现演进，这里保持宽松）
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Variables = {
  user: any;
  session: any;
};

async function main() {
  // 装配 framework 依赖（boot）+ 应用层初始化（迁移/seed/建表/清理定时器）
  await bootstrap();

  const serverConfig = getContainer().getConfig('server');

  // websocket.server 注入 wss：@hono/node-server 在 HTTP upgrade 时把连接交给 WebSocketServer 处理
  serve({
    fetch: app.fetch,
    port: serverConfig.port,
    hostname: '0.0.0.0',
    websocket: { server: wss }
  }, (info) => {
    logger.info({ port: info.port, deployMode: serverConfig.deploy_mode }, 'Server started');
  });
}

main().catch((err) => {
  logger.fatal({ err }, 'Server failed to start');
  process.exit(1);
});
