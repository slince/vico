// @vico/rag - 内存向量存储（进程内 Map 实现，供框架默认装配与测试使用）

import type { DistanceMetric, VectorQueryResult, VectorStore } from '../types/vector-store.js';

/** 单个索引的存储结构 */
interface VectorIndex {
  dimension: number;
  metric: DistanceMetric;
  rows: Map<string, { vector: number[]; metadata: Record<string, unknown> }>;
}

/** 余弦相似度（0~1，越大越相关） */
function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/** 元数据精确匹配（filter 所有键值均相等） */
function matches(metadata: Record<string, unknown>, filter: Record<string, unknown>): boolean {
  return Object.entries(filter).every(([key, value]) => metadata[key] === value);
}

/**
 * 内存版 {@link VectorStore}：进程内 Map 存储，进程重启后丢失。
 *
 * 与持久化适配器（`@vico/rag-libsql` / `@vico/rag-chroma`）同接口，
 * 供框架默认装配（boot 的 `vector: memory` 后端）及测试使用。
 */
export class InMemoryVectorStore implements VectorStore {
  private indexes = new Map<string, VectorIndex>();

  async createIndex(params: { indexName: string; dimension: number; metric: DistanceMetric; type?: string }): Promise<void> {
    if (!this.indexes.has(params.indexName)) {
      this.indexes.set(params.indexName, { dimension: params.dimension, metric: params.metric, rows: new Map() });
    }
  }

  async upsert(params: { indexName: string; vectors: number[][]; ids: string[]; metadata: Record<string, unknown>[]; type?: string }): Promise<void> {
    const index = this.indexes.get(params.indexName);
    if (!index) throw new Error(`[rag] Vector index not found: ${params.indexName}`);
    for (let i = 0; i < params.ids.length; i++) {
      index.rows.set(params.ids[i], { vector: params.vectors[i], metadata: params.metadata[i] });
    }
  }

  async query(params: { indexName: string; queryVector: number[]; topK: number; filter?: Record<string, unknown>; type?: string }): Promise<VectorQueryResult[]> {
    const index = this.indexes.get(params.indexName);
    if (!index) return [];
    const scored: VectorQueryResult[] = [];
    for (const [id, row] of index.rows) {
      if (params.filter && !matches(row.metadata, params.filter)) continue;
      scored.push({ id, score: cosine(params.queryVector, row.vector), metadata: row.metadata });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, params.topK);
  }

  async deleteVectors(params: { indexName: string; ids: string[] }): Promise<void> {
    const index = this.indexes.get(params.indexName);
    if (!index) return;
    for (const id of params.ids) index.rows.delete(id);
  }

  async dropIndex(indexName: string): Promise<void> {
    this.indexes.delete(indexName);
  }
}
