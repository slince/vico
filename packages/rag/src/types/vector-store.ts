// @vico/rag — VectorStore type definitions

/** 向量存储记录 — 内部使用 */
export interface VectorRecord {
  id: string;
  vector: number[];
  metadata: Record<string, unknown>;
}

/** 向量查询结果 */
export interface VectorQueryResult {
  id: string;
  /** 相似度分数 (0-1) */
  score: number;
  metadata: Record<string, unknown>;
}

/** 相似度度量 */
export type DistanceMetric = 'cosine' | 'euclidean' | 'dot_product';

/** 向量存储适配器接口 — 通用索引管理 + 相似度搜索 */
export interface VectorStore {
  /**
   * 创建索引（幂等：已存在则跳过）。
   *
   * @param params.indexName - 索引名称
   * @param params.dimension - 向量维度
   * @param params.metric - 相似度度量
   */
  createIndex(params: {
    indexName: string;
    dimension: number;
    metric: DistanceMetric;
  }): Promise<void>;

  /**
   * 批量 upsert 向量及元数据。
   * vectors、ids、metadata 三个数组必须等长且一一对应。
   */
  upsert(params: {
    indexName: string;
    vectors: number[][];
    ids: string[];
    metadata: Record<string, unknown>[];
  }): Promise<void>;

  /**
   * 按向量相似度查询 topK 条结果。
   *
   * @param params.filter - 可选元数据过滤条件（精确匹配）
   */
  query(params: {
    indexName: string;
    queryVector: number[];
    topK: number;
    filter?: Record<string, unknown>;
  }): Promise<VectorQueryResult[]>;

  /** 删除指定向量 */
  deleteVectors(params: {
    indexName: string;
    ids: string[];
  }): Promise<void>;

  /** 删除整个索引 */
  dropIndex(indexName: string): Promise<void>;
}
