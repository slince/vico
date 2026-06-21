// @vico/libsql — Public API barrel exports

// Schema — 供调用方纳入 drizzle-kit 生成迁移
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

// 启动时自动建表
export { ensureTables } from './migrate.js';
