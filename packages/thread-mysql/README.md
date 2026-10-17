# @vico/thread-mysql

MySQL 版 ThreadStore 持久化实现，实现 `@vico/thread` 的 `ThreadStore` 端口。

## 快速使用

```ts
import { drizzle } from 'drizzle-orm/mysql2';
import { createPool } from 'mysql2/promise';
import {
  MysqlThreadStore,
  ensureThreadTables,
  threads,
  turns,
  messages,
} from '@vico/thread-mysql';

const db = drizzle(createPool('mysql://user:pass@localhost:3306/vico'), {
  schema: { threads, turns, messages }, // 本包导出的表
});

await ensureThreadTables(db); // 启动时自动建表（补列检测走 INFORMATION_SCHEMA.COLUMNS）
const store = new MysqlThreadStore({ db });

await store.createThread('agent-1', '会话标题', 'thread-1', { userId: 'user-1' });
const thread = await store.getThread('thread-1');
```

## 相关文档

- [mysql-adapter 拆分](../../docs/insights/mysql-adapter-split.md)
