import { serve } from '@hono/node-server';
import { config } from './config.js';
import { skillManager } from './skill/manager.js';
import { runMigrations } from './db/run-migrations.js';
import { seedDefaultOrgAndAdmin, seedMainAgent } from './auth/seed.js';
import { getStorage } from './agent/memory-setup.js';
import { migrateMemoryEntries } from './db/migrate-memory-entries.js';
import { app } from './mastra.js';
import { auth } from './auth';
import logger from './lib/logger.js';

/** better-auth session 扩展类型 — 包含 organization 插件注入的 activeOrganizationId */
type SessionWithOrg = typeof auth.$Infer.Session.session & { activeOrganizationId?: string | null };

/** Hono 上下文变量类型 — better-auth session 信息 */
export type Variables = {
  user: typeof auth.$Infer.Session.user | null;
  session: SessionWithOrg | null;
};

async function main() {
  runMigrations();
  await skillManager.init();
  await getStorage().init(); // 初始化 Mastra 存储表（mastra_threads/messages/resources）
  // 将自定义 memory_entries 迁移到 Mastra 原生 WorkingMemory（非关键路径）
  migrateMemoryEntries().catch((err) => {
    logger.warn({ err }, 'Memory entries migration failed (non-critical)');
  });
  await seedDefaultOrgAndAdmin();
  await seedMainAgent();

  // app is imported from mastra.ts which already calls createApp() and configures MastraServer

  serve({ fetch: app.fetch, port: config.server.port, hostname: '0.0.0.0' }, (info) => {
    logger.info({ port: info.port, deployMode: config.server.deploy_mode }, 'Server started');
  });
}

main().catch((err) => {
  logger.fatal({ err }, 'Server failed to start');
  process.exit(1);
});
