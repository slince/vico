# mysql-adapter 拆分为 3 个领域子包

## 背景

延续 `@vico/libsql-adapter` 的拆分模式（见 [libsql-adapter-split.md](./libsql-adapter-split.md)），把 `@vico/mysql-adapter` 拆为领域子包并彻底移除原包。

差异：MySQL 版**无向量检索实现**（无 VectorStore），故只拆 3 个域；且 `@vico/mysql-adapter` 此前无任何消费方（server 走 libsql），无需改动消费方。

## 子包清单

| 包 | 职责 | 依赖（内部） |
|----|------|------|
| `@vico/thread-mysql` | `MysqlThreadStore` + `threads/turns/messages` schema + `ensureThreadTables` | `@vico/thread`、`drizzle-orm`、`mysql2` |
| `@vico/checkpoint-mysql` | `MysqlCheckpointStore` + `checkpoints` schema + `ensureCheckpointTables` | `@vico/checkpoint`、`drizzle-orm`、`mysql2` |
| `@vico/memory-mysql` | `MysqlSemanticMemory` + `memoryEntries` schema + `ensureMemoryTables` | `@vico/memory`、`drizzle-orm`、`mysql2` |

## 与 libsql 版的差异

- 表定义用 `drizzle-orm/mysql-core`（`mysqlTable`），db 类型用 `drizzle-orm/mysql2`（`MySql2Database`）；`ensureXxxTables` 用 `db.execute(sql...)`（MySQL driver 元组返回），补列检测走 `INFORMATION_SCHEMA.COLUMNS`。
- `ensureMemoryTables` 额外保留原「记忆类型重命名」幂等迁移（`working→semantic` / `semantic 向量→episodic` / `kb_%→knowledge` 三条 UPDATE）。
- 无测试文件（原包即无）。

## 验证

- `pnpm -r typecheck` 全绿（27 个项目）
- 3 个子包 `build`（tsc 声明产出）通过
- 无残留 `@vico/mysql-adapter` 引用
