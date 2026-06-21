// @vico/mysql-adapter — Public API barrel exports

// Schema — for callers to include in drizzle-kit migration generation
export {
  sessionThreads,
  sessionTurns,
  sessionMessages,
  memoryEntries,
} from './schema.js';

// SessionStore adapter
export {
  DrizzleSessionStore,
  type DrizzleSessionStoreOptions,
} from './drizzle-session-store.js';

// WorkingMemory adapter
export {
  DrizzleWorkingMemory,
  type DrizzleWorkingMemoryOptions,
} from './drizzle-working-memory.js';

// VectorStore adapter
export {
  DrizzleVectorStore,
  type DrizzleVectorStoreOptions,
} from './drizzle-vector-store.js';

// Auto-create tables at startup
export { ensureTables } from './migrate.js';
