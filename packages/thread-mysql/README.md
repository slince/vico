# @vico/thread-mysql

MySQL 版 ThreadStore 持久化实现，实现 `@vico/thread` 的 `ThreadStore` 端口。

## 主要导出

- `MysqlThreadStore` / `MysqlThreadStoreOptions` — MySQL 版 ThreadStore
- schema — `threads` / `turns` / `messages`（供调用方纳入 drizzle-kit 生成迁移）
- `ensureThreadTables` — 启动时自动建表（幂等，补列检测走 `INFORMATION_SCHEMA.COLUMNS`）

## 依赖

| 依赖 | 用途 |
|------|------|
| `@vico/thread` | ThreadStore 端口 |
| `drizzle-orm` | Drizzle ORM（mysql-core） |
| `mysql2` | MySQL 驱动 |

## 相关文档

- [mysql-adapter 拆分](../../docs/insights/mysql-adapter-split.md)
