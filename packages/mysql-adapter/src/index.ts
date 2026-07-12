// @vico/mysql-adapter — Public API barrel exports

// Schema — for callers to include in drizzle-kit migration generation
export {
  threads,
  turns,
  messages,
  checkpoints,
  memoryEntries,
} from './schema.js';

// ThreadStore adapter
export {
  MysqlThreadStore,
  type MysqlThreadStoreOptions,
} from './mysql-thread-store.js';

// WorkingMemory adapter
export {
  MysqlWorkingMemory,
  type MysqlWorkingMemoryOptions,
} from './mysql-working-memory.js';

// Auto-create tables at startup
export { ensureTables } from './migrate.js';

// CheckpointStore adapter
export {
  MysqlCheckpointStore,
} from './mysql-checkpoint-store.js';
