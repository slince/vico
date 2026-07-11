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
  DrizzleThreadStore,
  type DrizzleThreadStoreOptions,
} from './drizzle-thread-store.js';

// WorkingMemory adapter
export {
  DrizzleWorkingMemory,
  type DrizzleWorkingMemoryOptions,
} from './drizzle-working-memory.js';

// VectorStore adapter
export {
  LibSQLVectorStore,
  type LibSQLVectorStoreOptions,
} from './libsql-vector-store.js';

// CheckpointStore adapter
export {
  LibSqlCheckpointStore,
} from './checkpoint-store.js';

// 启动时自动建表
export { ensureTables } from './migrate.js';
