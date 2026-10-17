# chroma-adapter 重命名为 rag-chroma

## 背景

延续 libsql / mysql 两个 adapter 的拆分工作（见 [libsql-adapter-split.md](./libsql-adapter-split.md)、[mysql-adapter-split.md](./mysql-adapter-split.md)），`@vico/chroma-adapter` 本应「也拆下」。

但核查后确认：**它已经是拆分后的最终形态**，与 libsql / mysql 不同，无需拆分。

## 现状（拆分前）

`@vico/chroma-adapter` 只含单一 rag/向量域：

- 唯一实现 `ChromaVectorStore`，实现 `@vico/rag` 的 `VectorStore` 接口（`src/chroma-vector-store.ts`）
- 已依赖细粒度 `@vico/rag`（而非 `@vico/core`）
- 无 drizzle schema、无 `ensureXxxTables`、无 thread/checkpoint/memory 其他域
- 全仓库无消费方

即它天然等价于拆分后的 `@vico/rag-libsql`，没有可继续拆出的内容。

## 处理

重命名为 `@vico/rag-chroma`，与 `@vico/rag-libsql` 的「域-存储」命名对齐。

| 项 | 值 |
|----|----|
| 目录 | `packages/chroma-adapter` → `packages/rag-chroma` |
| 包名 | `@vico/chroma-adapter` → `@vico/rag-chroma` |
| 内容 | 不变（`ChromaVectorStore` + `ChromaVectorStoreOptions`） |
| 依赖 | 不变（`@vico/rag` + `chromadb`） |

## 改动清单

- `packages/rag-chroma/package.json`：`name` 字段
- `packages/rag-chroma/src/index.ts`、`src/chroma-vector-store.ts`：包名注释与 JSDoc 示例 import 路径
- `pnpm-lock.yaml`：importer 路径（`pnpm install` 自动更新）
- `docs/feature/rag-package-plan.md`：包名表格中的 chroma 行
- 删除本地陈旧 `dist/` 构建产物（未纳入 git）

## 验证

- `pnpm --filter @vico/rag-chroma typecheck` 通过
- `pnpm --filter @vico/rag-chroma build`（tsc 声明产出）通过
- 全仓库 grep 无 `chroma-adapter` / `@vico/chroma` 残留引用

## 命名约定（拆分后全貌）

存储适配器统一为「域-存储」命名，原 adapter 壳包全部移除：

- `@vico/thread-libsql` / `@vico/checkpoint-libsql` / `@vico/memory-libsql` / `@vico/rag-libsql`
- `@vico/thread-mysql` / `@vico/checkpoint-mysql` / `@vico/memory-mysql`
- `@vico/rag-chroma`
