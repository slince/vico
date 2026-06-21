// @vico/mysql-adapter — Public API barrel exports

// Schema — for callers to include in drizzle-kit migration generation
export {
  threads,
  turns,
  messages,
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

// Auto-create tables at startup
export { ensureTables } from './migrate.js';
