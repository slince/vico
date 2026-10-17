# @vico/thread-libsql

LibSQL 版 ThreadStore 持久化实现，实现 `@vico/thread` 的 `ThreadStore` 端口。

## 快速使用

```ts
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import {
  LibSqlThreadStore,
  ensureThreadTables,
  threads,
  turns,
  messages,
} from '@vico/thread-libsql';

const db = drizzle(createClient({ url: 'file:data.db' }), {
  schema: { threads, turns, messages }, // 本包导出的表
});

await ensureThreadTables(db); // 启动时自动建表（幂等，含补列迁移）
const store = new LibSqlThreadStore({ db });

await store.createThread('agent-1', '会话标题', 'thread-1', { userId: 'user-1' });
const thread = await store.getThread('thread-1');
```

## 相关文档

- [libsql-adapter 拆分](../../docs/insights/libsql-adapter-split.md)
