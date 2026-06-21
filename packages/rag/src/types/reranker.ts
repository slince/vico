// @vico/rag — Reranker type definitions
import type { VectorQueryResult } from './vector-store.js';

/** 重排序器接口 — 对检索结果二次打分排序 */
export interface Reranker {
  /**
   * 对候选结果重新排序。
   * @param query - 用户原始查询
   * @param results - 候选检索结果
   * @returns 重排序后的结果（按分数降序）
   */
  rerank(query: string, results: VectorQueryResult[]): Promise<VectorQueryResult[]>;
}
