// @vico/memory-mysql — MySQL SemanticMemory 持久化实现

// Schema — 供调用方纳入 drizzle-kit 生成迁移
export {
  memoryEntries,
} from './schema.js';

// SemanticMemory adapter
export {
  MysqlSemanticMemory,
  type MysqlSemanticMemoryOptions,
} from './mysql-semantic-memory.js';

// 启动时自动建表
export { ensureMemoryTables } from './migrate.js';
