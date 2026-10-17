# @vico/rag

RAG 核心能力：分块、嵌入、文档解析、混合检索管道、向量存储端口。

## 主要导出

- 类型 — `Chunker` / `Embedder` / `VectorStore` / `Parser` / `ParserRegistry` / `RetrievalPipeline` / `Reranker` / `RagProvider` 及配置类型；`DEFAULT_RAG_CONFIG`
- 分块 — `RecursiveChunker` / `SentenceChunker` / `MarkdownChunker` / `CodeChunker`
- 嵌入 — `createEmbedder` / `FastEmbedEmbedder` / `OpenAIEmbedder`
- 解析 — `DefaultParserRegistry` / `TextParser` / `MarkdownParser` / `PdfParser` / `DocxParser` / `CsvParser` / `HtmlParser`
- 检索 — `dedup` / `formatResults` / `joinResults` / `DefaultQueryRewriter` / `DefaultRetrievalPipeline`
- 工具 — `createSearchTool` 及类型（`RagToolOptions` / `RagToolExecuteParams` / `RagToolResult`）

## 依赖

| 依赖 | 用途 |
|------|------|
| `zod` | schema 校验 |

## 相关文档

- [libsql-adapter 拆分](../../docs/insights/libsql-adapter-split.md)（VectorStore 端口的持久化实现）
