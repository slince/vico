import {serve} from '@hono/node-server';
import {config} from './config.js';
import {runMigrations} from './db/run-migrations.js';
import {seedDefaultOrgAndAdmin, seedMainAgent} from './auth/seed.js';
import {app, initVico} from './vico.js';
import {auth} from './auth';
import logger from './lib/logger.js';

/** better-auth session 扩展类型 */
type SessionWithOrg = typeof auth.$Infer.Session.session & { activeOrganizationId?: string | null };

/** Hono 上下文变量类型 */
export type Variables = {
  user: typeof auth.$Infer.Session.user | null;
  session: SessionWithOrg | null;
};

async function main() {
  await runMigrations();
  await seedDefaultOrgAndAdmin();
  await seedMainAgent();
  await initVico();

  serve({ fetch: app.fetch, port: config.server.port, hostname: '0.0.0.0' }, (info) => {
    logger.info({ port: info.port, deployMode: config.server.deploy_mode }, 'Server started');
  });
}

main().catch((err) => {
  logger.fatal({ err }, 'Server failed to start');
  process.exit(1);
});
