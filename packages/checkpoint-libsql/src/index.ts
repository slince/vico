// @vico/checkpoint-libsql — LibSQL CheckpointStore 持久化实现

// Schema — 供调用方纳入 drizzle-kit 生成迁移
export {
  checkpoints,
  checkpointsThreadIdIdx,
} from './schema.js';

// CheckpointStore adapter
export {
  LibSqlCheckpointStore,
} from './libsql-checkpoint-store.js';

// 启动时自动建表
export { ensureCheckpointTables } from './migrate.js';
