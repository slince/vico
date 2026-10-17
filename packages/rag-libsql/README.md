# @vico/rag-libsql

LibSQL 原生向量存储实现，实现 `@vico/rag` 的 `VectorStore` 端口。

基于原生 SQL（`F32_BLOB` + `vector_distance_cos`），不经过 Drizzle ORM。

## 主要导出

- `LibSQLVectorStore` / `LibSQLVectorStoreOptions` — LibSQL 版 VectorStore

## 建表说明

本包不提供建表函数（与原 `@vico/libsql-adapter` 一致）：向量存储只在其内部 `ensureLoaded()` 里自建 `vico_index_config`，不建 `vico_memory_entries`。后者由 `@vico/memory-libsql` 的 `ensureMemoryTables` 保证。

## 依赖

| 依赖 | 用途 |
|------|------|
| `@vico/rag` | VectorStore 端口 |
| `@libsql/client` | LibSQL 客户端 |

## 相关文档

- [libsql-adapter 拆分](../../docs/insights/libsql-adapter-split.md)
