// @vico/checkpoint-mysql — MySQL CheckpointStore 持久化实现

// Schema — 供调用方纳入 drizzle-kit 生成迁移
export {
  checkpoints,
} from './schema.js';

// CheckpointStore adapter
export {
  MysqlCheckpointStore,
} from './mysql-checkpoint-store.js';

// 启动时自动建表
export { ensureCheckpointTables } from './migrate.js';
