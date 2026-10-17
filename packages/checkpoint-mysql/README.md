# @vico/checkpoint-mysql

MySQL 版 CheckpointStore 持久化实现，实现 `@vico/checkpoint` 的 `CheckpointStore` 端口。

## 主要导出

- `MysqlCheckpointStore` — MySQL 版 CheckpointStore
- schema — `checkpoints`（供调用方纳入 drizzle-kit 生成迁移）
- `ensureCheckpointTables` — 启动时自动建表（幂等，补列检测走 `INFORMATION_SCHEMA.COLUMNS`）

## 依赖

| 依赖 | 用途 |
|------|------|
| `@vico/checkpoint` | CheckpointStore 端口 |
| `drizzle-orm` | Drizzle ORM（mysql-core） |
| `mysql2` | MySQL 驱动 |

## 相关文档

- [mysql-adapter 拆分](../../docs/insights/mysql-adapter-split.md)
