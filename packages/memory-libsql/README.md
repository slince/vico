# @vico/memory-libsql

LibSQL 版 SemanticMemory 持久化实现，实现 `@vico/memory` 的 `SemanticMemory` 端口。

## 快速使用

```ts
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { LibSqlSemanticMemory, ensureMemoryTables, memoryEntries } from '@vico/memory-libsql';

const db = drizzle(createClient({ url: 'file:data.db' }), {
  schema: { memoryEntries }, // 本包导出的表
});

await ensureMemoryTables(db); // 启动时自动建表（含补列迁移）
const semantic = new LibSqlSemanticMemory({ db });

await semantic.set('user-1', '# 用户画像\n偏好中文回复');
const profile = await semantic.get('user-1');
```

## 相关文档

- [libsql-adapter 拆分](../../docs/insights/libsql-adapter-split.md)
