# @vico/rag

RAG 核心能力：分块、嵌入、文档解析、混合检索管道、向量存储端口。

## 快速使用

```ts
import {
  RecursiveChunker,
  createEmbedder,
  DefaultRetrievalPipeline,
} from '@vico/rag';

// 1. 分块
const chunks = await new RecursiveChunker().chunk(longText, { size: 500, overlap: 50 });

// 2. 嵌入（本地 fastembed，或 { provider: 'openai', apiKey }）
const embedder = createEmbedder('fastembed');

// 3. 检索管道：query rewrite → embed → vector search → filter → dedup → rerank → format
const pipeline = new DefaultRetrievalPipeline({ embedder, vectorStore });
const results = await pipeline.search({
  indexName: 'kb-demo',
  query: '关键词',
  topK: 5,
  similarityThreshold: 0.6,
});
```

## 相关文档

- [libsql-adapter 拆分](../../docs/insights/libsql-adapter-split.md)（VectorStore 端口的持久化实现）
