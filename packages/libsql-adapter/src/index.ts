// @vico/libsql-adapter — Public API barrel exports

// Schema — 供调用方纳入 drizzle-kit 生成迁移
export {
  threads,
  turns,
  messages,
  checkpoints,
  memoryEntries,
} from './schema.js';

// ThreadStore adapter
export {
  LibSqlThreadStore,
  type LibSqlThreadStoreOptions,
} from './libsql-thread-store.js';

// WorkingMemory adapter
export {
  LibSqlWorkingMemory,
  type LibSqlWorkingMemoryOptions,
} from './libsql-working-memory.js';

// VectorStore adapter
export {
  LibSQLVectorStore,
  type LibSQLVectorStoreOptions,
} from './libsql-vector-store.js';

// CheckpointStore adapter
export {
  LibSqlCheckpointStore,
} from './libsql-checkpoint-store.js';

// 启动时自动建表
export { ensureTables } from './migrate.js';
