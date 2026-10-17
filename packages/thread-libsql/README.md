# @vico/thread-libsql

LibSQL 版 ThreadStore 持久化实现，实现 `@vico/thread` 的 `ThreadStore` 端口。

## 主要导出

- `LibSqlThreadStore` / `LibSqlThreadStoreOptions` — LibSQL 版 ThreadStore
- schema — `threads` / `turns` / `messages`（供调用方纳入 drizzle-kit 生成迁移）
- `ensureThreadTables` — 启动时自动建表（幂等，含补列迁移）

## 依赖

| 依赖 | 用途 |
|------|------|
| `@vico/thread` | ThreadStore 端口 |
| `drizzle-orm` | Drizzle ORM（sqlite-core） |

## 相关文档

- [libsql-adapter 拆分](../../docs/insights/libsql-adapter-split.md)
