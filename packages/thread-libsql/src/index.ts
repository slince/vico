// @vico/thread-libsql — LibSQL ThreadStore 持久化实现

// Schema — 供调用方纳入 drizzle-kit 生成迁移
export {
  threads,
  turns,
  messages,
} from './schema.js';

// ThreadStore adapter
export {
  LibSqlThreadStore,
  type LibSqlThreadStoreOptions,
} from './libsql-thread-store.js';

// 启动时自动建表
export { ensureThreadTables } from './migrate.js';
