# @vico/memory-mysql

MySQL 版 SemanticMemory 持久化实现，实现 `@vico/memory` 的 `SemanticMemory` 端口。

## 快速使用

```ts
import { drizzle } from 'drizzle-orm/mysql2';
import { createPool } from 'mysql2/promise';
import { MysqlSemanticMemory, ensureMemoryTables, memoryEntries } from '@vico/memory-mysql';

const db = drizzle(createPool('mysql://user:pass@localhost:3306/vico'), {
  schema: { memoryEntries }, // 本包导出的表
});

await ensureMemoryTables(db); // 启动时自动建表（含记忆类型重命名幂等迁移）
const semantic = new MysqlSemanticMemory({ db });

await semantic.set('user-1', '# 用户画像\n偏好中文回复');
const profile = await semantic.get('user-1');
```

## 相关文档

- [mysql-adapter 拆分](../../docs/insights/mysql-adapter-split.md)
