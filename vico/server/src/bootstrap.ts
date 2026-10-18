import { createVicoContainer, vicoProviders } from '@vico/boot';
import type { VicoContainer, VicoServiceProvider } from '@vico/boot';
import { ensureCheckpointTables } from '@vico/checkpoint-libsql';
import { ensureMemoryTables } from '@vico/memory-libsql';
import { ensureThreadTables } from '@vico/thread-libsql';
import { startCheckpointPurge } from './checkpoint-purge.js';
import { CONFIG_PATH } from './config.js';
import { setContainer } from './container.js';
import { runMigrations } from './db/run-migrations.js';
import { getDb } from './db/db.js';
import { getClient } from './db/init-libsql.js';
import { seedDefaultAdmin, seedMainAgent } from './auth/seed.js';
import logger from './lib/logger.js';

/**
 * 应用层 provider：boot 阶段执行迁移、seed、建表与 checkpoint 清理定时器。
 * register 阶段无绑定——db/client 连接由 bootstrap() 显式注入。
 */
const serverProvider: VicoServiceProvider = {
  register() {},

  async boot(c) {
    await runMigrations();
    await seedDefaultAdmin();
    await seedMainAgent();

    // 确保 Vico 持久化表存在（thread / checkpoint / memory 三域）
    const db = getDb();
    await ensureThreadTables(db as any);
    await ensureCheckpointTables(db as any);
    await ensureMemoryTables(db as any);

    // checkpoint 版本链 TTL 清理：启动一次 + 每小时一次
    startCheckpointPurge(
      c.resolve('checkpointStore'),
      c.getConfig('checkpoint').ttl_days * 24 * 60 * 60 * 1000,
      logger,
    );

    logger.info('Vico agent framework initialized');
  },
};

/**
 * 启动 server：装配 framework（boot 各领域 provider）+ 应用层依赖。
 *
 * 应用层注入 libsql 连接（db/client），供 framework 的 thread/checkpoint/vector
 * 后端按 storage 配置解析使用；随后依序执行迁移、seed、建表等初始化副作用。
 *
 * @returns 完成启动后的 Vico 容器
 */
export async function bootstrap(): Promise<VicoContainer> {
  const container = createVicoContainer({ configPath: CONFIG_PATH });

  // 注入 libsql 连接（token 名与 storage.db_service / client_service 对齐）
  container.register('db', () => getDb());
  container.register('client', () => getClient());

  await container.bootstrap([...vicoProviders, serverProvider]);
  setContainer(container);
  return container;
}
