# @vico/rag-chroma

Chroma 向量存储实现，实现 `@vico/rag` 的 `VectorStore` 端口。

每个 RAG indexName 映射为一个 Chroma collection（名称：`${namespace}_${indexName}`），支持懒创建与缓存。

## 主要导出

- `ChromaVectorStore` / `ChromaVectorStoreOptions` — Chroma 版 VectorStore

## 依赖

| 依赖 | 用途 |
|------|------|
| `@vico/rag` | VectorStore 端口 |
| `chromadb` | Chroma 客户端 |

## 相关文档

- [chroma-adapter 重命名](../../docs/insights/chroma-adapter-rename.md)
