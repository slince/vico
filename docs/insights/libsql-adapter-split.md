# libsql-adapter 拆分为 4 个领域子包

## 背景

原 `@vico/libsql-adapter` 把 thread / checkpoint / memory / rag 四个领域的 LibSQL 持久化实现揉在一个包，复用任一实现都要拖入整个包及其全部依赖（`@vico/core` + `@vico/rag` + drizzle + `@libsql/client`）。

拆分为 4 个细粒度子包后，每个只依赖对应领域包，可独立复用；`@vico/libsql-adapter` 已彻底删除。

## 子包清单

| 包 | 职责 | 依赖（内部） |
|----|------|------|
| `@vico/thread-libsql` | `LibSqlThreadStore` + `threads/turns/messages` schema + `ensureThreadTables` | `@vico/thread`、`drizzle-orm` |
| `@vico/checkpoint-libsql` | `LibSqlCheckpointStore` + `checkpoints` schema + `ensureCheckpointTables` | `@vico/checkpoint`、`drizzle-orm` |
| `@vico/memory-libsql` | `LibSqlSemanticMemory` + `memoryEntries` schema + `ensureMemoryTables` | `@vico/memory`、`drizzle-orm` |
| `@vico/rag-libsql` | `LibSQLVectorStore`（原生 SQL，无 drizzle） | `@vico/rag`、`@libsql/client` |

## 关键设计

- 所有子包不再依赖 `@vico/core`，改为细粒度域包（`@vico/thread` / `@vico/checkpoint` / `@vico/memory` / `@vico/rag`）。
- `vico_memory_entries` 表归 `@vico/memory-libsql` 所有（semantic 文本行与 episodic/knowledge 向量行共存）。`@vico/rag-libsql` 的 `LibSQLVectorStore` 不建该表，只在 JSDoc 注明依赖 `ensureMemoryTables` 保证其存在；其 `vico_index_config` 表仍由 `ensureLoaded()` 自建。
- 原单一 `ensureTables` 拆成三个 `ensureXxxTables(db: LibSQLDatabase<Record<string, never>>)`，各自只含本域 DDL + 幂等迁移检测（archived / forked_from / checkpoint 旧复合主键重建）。
- 测试按域下沉：`thread-libsql`（store 测试 + turns 补列迁移）、`checkpoint-libsql`（checkpoint 版本树建表 + 旧结构重建）。

## 消费方改动（@vico/server）

1. `vico/server/src/vico.ts`：`ensureTables(db)` → 顺序调用 `ensureThreadTables` / `ensureCheckpointTables` / `ensureMemoryTables`。
2. `vico/server/src/memory/memory-setup.ts`：4 个 store 改为从 4 个子包分别导入。
3. `vico/server/package.json`：移除 `@vico/libsql-adapter`，新增 4 个 `workspace:*` 依赖。

## 验证

- `pnpm -r typecheck` 全绿（25 个项目）
- `@vico/thread-libsql` / `@vico/checkpoint-libsql` 测试各 2 个通过
- `vico/server` `tsc --noEmit` 通过
- 4 个子包 `build`（tsc 声明产出）通过
