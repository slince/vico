// @vico/rag — Types barrel export
export type { ChunkStrategy, ChunkOptions, Chunk, Chunker } from './chunk.js';
export type { EmbedOptions, EmbedResult, Embedder } from './embedder.js';
export type {
  VectorRecord,
  VectorQueryResult,
  DistanceMetric,
  VectorStore,
} from './vector-store.js';
export type { ParseResult, Parser, ParserRegistry } from './document.js';
export type {
  SearchOptions,
  SearchResult,
  RetrievalPipeline,
  QueryRewriter,
  HybridWeights,
  HybridSearcher,
} from './retrieval.js';
export type { Reranker } from './reranker.js';
export type {
  ChunkConfig,
  RetrievalConfig,
  QueryRewriteConfig,
  RerankConfig,
  NoMatchStrategy,
  RagConfig,
} from './config.js';
export { DEFAULT_RAG_CONFIG } from './config.js';
