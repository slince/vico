# @vico/rag-chroma

Chroma 向量存储实现，实现 `@vico/rag` 的 `VectorStore` 端口。

每个 RAG indexName 映射为一个 Chroma collection（名称：`${namespace}_${indexName}`），支持懒创建与缓存。

## 快速使用

```ts
import { ChromaClient } from 'chromadb';
import { ChromaVectorStore } from '@vico/rag-chroma';

const store = new ChromaVectorStore({
  client: new ChromaClient({ path: 'http://localhost:8000' }),
  namespace: 'vico', // 可选，collection 名称前缀
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

## 相关文档

- [chroma-adapter 重命名](../../docs/insights/chroma-adapter-rename.md)
