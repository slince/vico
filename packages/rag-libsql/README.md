# @vico/rag-libsql

LibSQL 原生向量存储实现，实现 `@vico/rag` 的 `VectorStore` 端口。

基于原生 SQL（`F32_BLOB` + `vector_distance_cos`），不经过 Drizzle ORM。

## 快速使用

```ts
import { createClient } from '@libsql/client';
import { LibSQLVectorStore } from '@vico/rag-libsql';

const store = new LibSQLVectorStore({
  client: createClient({ url: 'file:data.db' }),
});

await store.createIndex({ indexName: 'kb-demo', dimension: 1536, metric: 'cosine' });
await store.upsert({
  indexName: 'kb-demo',
  vectors: [embedding], // number[]
  ids: ['1'],
  metadata: [{ content: '待检索的文本' }],
});

const results = await store.query({
  indexName: 'kb-demo',
  queryVector: embedding,
  topK: 5,
});
```

> 注意：本类不建 `vico_memory_entries` 表，需由 `@vico/memory-libsql` 的 `ensureMemoryTables` 保证其存在。

## 相关文档

- [libsql-adapter 拆分](../../docs/insights/libsql-adapter-split.md)
