# @vico/memory-mysql

MySQL 版 SemanticMemory 持久化实现，实现 `@vico/memory` 的 `SemanticMemory` 端口。

## 主要导出

- `MysqlSemanticMemory` / `MysqlSemanticMemoryOptions` — MySQL 版 SemanticMemory
- schema — `memoryEntries`（供调用方纳入 drizzle-kit 生成迁移）
- `ensureMemoryTables` — 启动时自动建表（幂等，含「记忆类型重命名」幂等迁移）

## 依赖

| 依赖 | 用途 |
|------|------|
| `@vico/memory` | SemanticMemory 端口 |
| `drizzle-orm` | Drizzle ORM（mysql-core） |
| `mysql2` | MySQL 驱动 |

## 相关文档

- [mysql-adapter 拆分](../../docs/insights/mysql-adapter-split.md)
