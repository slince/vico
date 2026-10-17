# @vico/checkpoint-libsql

LibSQL 版 CheckpointStore 持久化实现，实现 `@vico/checkpoint` 的 `CheckpointStore` 端口。

## 快速使用

```ts
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { LibSqlCheckpointStore, ensureCheckpointTables } from '@vico/checkpoint-libsql';

const db = drizzle(createClient({ url: 'file:data.db' }));

await ensureCheckpointTables(db); // 启动时自动建表（含旧复合主键 DROP 重建）
const store = new LibSqlCheckpointStore(db as any); // schema 含索引列，最小示例用 as any 对齐

const ckpt = await store.create('turn-1', 'thread-1');
const latest = await store.getLatest('turn-1');
```

## 相关文档

- [libsql-adapter 拆分](../../docs/insights/libsql-adapter-split.md)
