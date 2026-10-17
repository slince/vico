# @vico/memory-libsql

LibSQL 版 SemanticMemory 持久化实现，实现 `@vico/memory` 的 `SemanticMemory` 端口。

## 主要导出

- `LibSqlSemanticMemory` / `LibSqlSemanticMemoryOptions` — LibSQL 版 SemanticMemory
- schema — `memoryEntries`（供调用方纳入 drizzle-kit 生成迁移）
- `ensureMemoryTables` — 启动时自动建表（幂等，含补列迁移）

> `vico_memory_entries` 归 memory 域所有（`memoryEntries` 既是 semantic 行也是向量行）；`@vico/rag-libsql` 依赖本包保证该表存在。

## 依赖

| 依赖 | 用途 |
|------|------|
| `@vico/memory` | SemanticMemory 端口 |
| `drizzle-orm` | Drizzle ORM（sqlite-core） |

## 相关文档

- [libsql-adapter 拆分](../../docs/insights/libsql-adapter-split.md)
