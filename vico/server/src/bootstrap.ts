import { createVicoContainer } from '@vico/boot';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureCheckpointTables } from '@vico/checkpoint-libsql';
import { ensureMemoryTables } from '@vico/memory-libsql';
import { ensureThreadTables } from '@vico/thread-libsql';
import { startCheckpointPurge } from './checkpoint-purge.js';
import {
  authSchema,
  databaseSchema,
  fileStorageSchema,
  serverSchema,
  uploadSchema,
  type ServerConfigKeys,
} from './config/schemas.js';
import type { ServerContainer, ServerServiceProvider } from './tokens.js';
import { servicesProvider } from './services-provider.js';
import { setContainer } from './container.js';
import { runMigrations } from './db/run-migrations.js';
import { getDb } from './db/db.js';
import { getClient } from './db/init-libsql.js';
import { seedDefaultAdmin, seedMainAgent } from './auth/seed.js';
import logger from './lib/logger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** 配置文件路径（应用层与 framework 共用同一份 server.config.yaml） */
const CONFIG_PATH = process.env.CONFIG_PATH || resolve(__dirname, '../server.config.yaml');

/**
 * 应用层 provider：
 * - register：把 server 专属配置段（server/auth/database/file_storage/upload）注册进容器；
 * - boot：执行迁移、seed、建表与 checkpoint 清理定时器。
 *
 * db/client 连接由 bootstrap() 显式注入（token 名与 storage.db_service / client_service 对齐）。
 */
const serverProvider: ServerServiceProvider = {
  register(c) {
    c
      .registerConfig('server', serverSchema)
      .registerConfig('auth', authSchema)
      .registerConfig('database', databaseSchema)
      .registerConfig('file_storage', fileStorageSchema)
      .registerConfig('upload', uploadSchema);
  },

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
 * 容器在 bootstrap 之前即写入全局单例：boot 阶段（迁移/建表）需要读取 database 配置。
 *
 * @returns 完成启动后的 server 容器
 */
export async function bootstrap(): Promise<ServerContainer> {
  // framework 领域 provider 由 createVicoContainer 注册；setup 在 load/冻结前注入连接与业务 provider
  const container = await createVicoContainer<ServerConfigKeys>({
    configPath: CONFIG_PATH,
    setup: async (c) => {
      // ServerTokens 视角：注入 libsql 连接（token 名与 storage.db_service / client_service 对齐）
      const sc = c as unknown as ServerContainer;
      sc.register('db', () => getDb());
      sc.register('client', () => getClient());
      for (const provider of [serverProvider, servicesProvider] as ServerServiceProvider[]) {
        await sc.registerProvider(provider);
      }
    },
  }) as unknown as ServerContainer;

  // 记录容器，让 boot 阶段的 getDb()/getConfig('database') 可用
  setContainer(container);

  await container.boot();
  return container;
}
