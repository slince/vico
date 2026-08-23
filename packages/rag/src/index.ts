// @vico/rag — Public API

// Types
export type {
  ChunkStrategy, ChunkOptions, Chunk, Chunker,
} from './types/chunk.js';
export type {
  EmbedOptions, EmbedResult, Embedder,
} from './types/embedder.js';
export type {
  VectorRecord, VectorQueryResult, DistanceMetric, VectorStore,
} from './types/vector-store.js';
export type {
  ParseResult, Parser, ParserRegistry,
} from './types/document.js';
export type {
  SearchOptions, SearchResult, RetrievalPipeline,
  QueryRewriter, HybridWeights, HybridSearcher,
} from './types/retrieval.js';
export type {
  Reranker,
} from './types/reranker.js';
export type {
  ChunkConfig, RetrievalConfig, QueryRewriteConfig, RerankConfig,
  NoMatchStrategy, RagConfig,
} from './types/config.js';
export { DEFAULT_RAG_CONFIG } from './types/config.js';

// Chunking
export { RecursiveChunker } from './chunking/recursive.js';
export { SentenceChunker } from './chunking/sentence.js';
export { MarkdownChunker } from './chunking/markdown.js';
export { CodeChunker } from './chunking/code.js';

// Embedding
export { createEmbedder } from './embedding/index.js';
export { FastEmbedEmbedder, type FastEmbedOptions } from './embedding/fastembed.js';
export { OpenAIEmbedder, type OpenAIEmbedderOptions } from './embedding/openai.js';

// Vector Store
export { InMemoryVectorStore } from './vector-store/in-memory.js';

// Parsing
export { DefaultParserRegistry } from './parsing/registry.js';
export { TextParser } from './parsing/text-parser.js';
export { MarkdownParser } from './parsing/markdown-parser.js';
export { PdfParser } from './parsing/pdf-parser.js';
export { DocxParser } from './parsing/docx-parser.js';
export { CsvParser } from './parsing/csv-parser.js';
export { HtmlParser } from './parsing/html-parser.js';

// Retrieval
export { dedup } from './retrieval/dedup.js';
export { formatResults, joinResults } from './retrieval/formatter.js';
export { DefaultQueryRewriter } from './retrieval/query-rewrite.js';
export { DefaultRetrievalPipeline, type PipelineOptions } from './retrieval/pipeline.js';

// Tool
export { createSearchTool } from './tool/rag-tool.js';
export type { RagToolOptions, RagToolExecuteParams, RagToolResult } from './tool/rag-tool.js';
