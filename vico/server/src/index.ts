import {serve} from '@hono/node-server';
import {config} from './config.js';
import {runMigrations} from './db/run-migrations.js';
import {seedDefaultAdmin, seedMainAgent} from './auth/seed.js';
import {app, initVico, wss} from './vico.js';
import {auth} from './auth';
import logger from './lib/logger.js';

/** Hono 上下文变量类型 */
export type Variables = {
  user: typeof auth.$Infer.Session.user | null;
  session: typeof auth.$Infer.Session.session | null;
};

async function main() {
  await runMigrations();
  await seedDefaultAdmin();
  await seedMainAgent();
  await initVico();

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
