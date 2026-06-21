// @vico/rag — Retrieval pipeline type definitions
import type { VectorQueryResult } from './vector-store.js';

/** 检索搜索选项 */
export interface SearchOptions {
  /** 用户查询 */
  query: string;
  /** 目标索引名称 */
  indexName: string;
  /** 返回结果数 */
  topK?: number;
  /** 相似度阈值 */
  similarityThreshold?: number;
  /** 元数据过滤条件 */
  filter?: Record<string, unknown>;
  /** 是否启用查询改写 */
  enableRewrite?: boolean;
  /** 是否启用重排序 */
  enableRerank?: boolean;
}

/** 检索结果 */
export interface SearchResult {
  id: string;
  content: string;
  score: number;
  metadata: Record<string, unknown>;
}

/** 检索管道接口 */
export interface RetrievalPipeline {
  search(options: SearchOptions): Promise<SearchResult[]>;
}

/** 查询改写器接口 */
export interface QueryRewriter {
  /** 将用户查询改写为多个检索变体 */
  rewrite(query: string): Promise<string[]>;
}

/** 混合搜索权重 */
export interface HybridWeights {
  dense: number;
  sparse: number;
}

/** 混合搜索器接口 */
export interface HybridSearcher {
  /**
   * 混合搜索（语义 + 关键词加权融合）。
   * @param denseResults - 语义搜索结果
   * @param sparseResults - 关键词搜索结果
   * @param weights - 权重配置
   */
  fuse(
    denseResults: VectorQueryResult[],
    sparseResults: VectorQueryResult[],
    weights: HybridWeights,
  ): VectorQueryResult[];
}
