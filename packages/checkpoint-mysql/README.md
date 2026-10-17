# @vico/checkpoint-mysql

MySQL 版 CheckpointStore 持久化实现，实现 `@vico/checkpoint` 的 `CheckpointStore` 端口。

## 快速使用

```ts
import { drizzle } from 'drizzle-orm/mysql2';
import { createPool } from 'mysql2/promise';
import { MysqlCheckpointStore, ensureCheckpointTables } from '@vico/checkpoint-mysql';

const db = drizzle(createPool('mysql://user:pass@localhost:3306/vico'));

await ensureCheckpointTables(db); // 启动时自动建表（补列检测走 INFORMATION_SCHEMA.COLUMNS）
const store = new MysqlCheckpointStore(db as any); // schema 含索引列，最小示例用 as any 对齐

const ckpt = await store.create('turn-1', 'thread-1');
const latest = await store.getLatest('turn-1');
```

## 相关文档

- [mysql-adapter 拆分](../../docs/insights/mysql-adapter-split.md)
