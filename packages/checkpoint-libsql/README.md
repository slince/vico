# @vico/checkpoint-libsql

LibSQL 版 CheckpointStore 持久化实现，实现 `@vico/checkpoint` 的 `CheckpointStore` 端口。

## 主要导出

- `LibSqlCheckpointStore` — LibSQL 版 CheckpointStore
- schema — `checkpoints` / `checkpointsThreadIdIdx`（供调用方纳入 drizzle-kit 生成迁移）
- `ensureCheckpointTables` — 启动时自动建表（幂等，含旧复合主键 DROP 重建逻辑）

## 依赖

| 依赖 | 用途 |
|------|------|
| `@vico/checkpoint` | CheckpointStore 端口 |
| `drizzle-orm` | Drizzle ORM（sqlite-core） |

## 相关文档

- [libsql-adapter 拆分](../../docs/insights/libsql-adapter-split.md)
