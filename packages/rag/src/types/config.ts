// @vico/rag — Global RAG configuration
import type { ChunkStrategy } from './chunk.js';

/** 分块默认配置 */
export interface ChunkConfig {
  strategy: ChunkStrategy;
  size: number;
  overlap: number;
}

/** 检索默认配置 */
export interface RetrievalConfig {
  topK: number;
  /** 相似度阈值，低于此值的检索结果会被过滤 */
  similarityThreshold: number;
}

/** 查询改写配置 */
export interface QueryRewriteConfig {
  enabled: boolean;
  /** LLM 改写 prompt 模板 */
  prompt?: string;
}

/** 重排序配置 */
export interface RerankConfig {
  enabled: boolean;
  /** reranker 模型名称 */
  model?: string;
}

/** 无匹配结果策略 */
export type NoMatchStrategy = 'free_answer' | 'fallback' | 'reject';

/** RAG 全局配置 */
export interface RagConfig {
  chunk: ChunkConfig;
  retrieval: RetrievalConfig;
  queryRewrite: QueryRewriteConfig;
  rerank: RerankConfig;
  noMatch: {
    strategy: NoMatchStrategy;
    fallbackMessage?: string;
  };
}

/** 默认 RAG 配置 */
export const DEFAULT_RAG_CONFIG: RagConfig = {
  chunk: {
    strategy: 'recursive',
    size: 512,
    overlap: 64,
  },
  retrieval: {
    topK: 5,
    similarityThreshold: 0.7,
  },
  queryRewrite: {
    enabled: false,
  },
  rerank: {
    enabled: false,
  },
  noMatch: {
    strategy: 'free_answer',
  },
};
