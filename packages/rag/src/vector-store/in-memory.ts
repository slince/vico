// @vico/rag — InMemoryVectorStore: 基于数组和余弦相似度的内存版向量存储
import type { DistanceMetric, VectorRecord, VectorQueryResult, VectorStore } from '../types/vector-store.js';

interface IndexEntry {
  records: VectorRecord[];
  metric: DistanceMetric;
  dimension: number;
}

/**
 * InMemoryVectorStore — 进程内向量存储。
 *
 * 适用场景：开发/测试，或不需要持久化的小规模数据。
 * 每个实例通过 indexName 命名空间隔离多个索引。
 */
export class InMemoryVectorStore implements VectorStore {
  private indices: Map<string, IndexEntry> = new Map();

  async createIndex(params: { indexName: string; dimension: number; metric: DistanceMetric }): Promise<void> {
    if (!this.indices.has(params.indexName)) {
      this.indices.set(params.indexName, {
        records: [],
        metric: params.metric,
        dimension: params.dimension,
      });
    }
  }

  async upsert(params: {
    indexName: string;
    vectors: number[][];
    ids: string[];
    metadata: Record<string, unknown>[];
  }): Promise<void> {
    let entry = this.indices.get(params.indexName);
    if (!entry) {
      entry = { records: [], metric: 'cosine', dimension: params.vectors[0]?.length ?? 0 };
      this.indices.set(params.indexName, entry);
    }

    for (let i = 0; i < params.ids.length; i++) {
      // 删除同 ID 旧记录
      const oldIdx = entry.records.findIndex((r) => r.id === params.ids[i]);
      if (oldIdx >= 0) entry.records.splice(oldIdx, 1);

      entry.records.push({
        id: params.ids[i],
        vector: params.vectors[i],
        metadata: params.metadata[i] ?? {},
      });
    }
  }

  async query(params: {
    indexName: string;
    queryVector: number[];
    topK: number;
    filter?: Record<string, unknown>;
  }): Promise<VectorQueryResult[]> {
    const entry = this.indices.get(params.indexName);
    if (!entry) return [];

    const scored: VectorQueryResult[] = [];
    for (const record of entry.records) {
      // 元数据过滤
      if (params.filter && !this.matchFilter(record.metadata, params.filter)) {
        continue;
      }
      const score = this.similarity(params.queryVector, record.vector, entry.metric);
      scored.push({ id: record.id, score, metadata: record.metadata });
    }

    return scored.sort((a, b) => b.score - a.score).slice(0, params.topK);
  }

  async deleteVectors(params: { indexName: string; ids: string[] }): Promise<void> {
    const entry = this.indices.get(params.indexName);
    if (!entry) return;
    const idSet = new Set(params.ids);
    entry.records = entry.records.filter((r) => !idSet.has(r.id));
  }

  async dropIndex(indexName: string): Promise<void> {
    this.indices.delete(indexName);
  }

  // ---- 私有 ----

  private similarity(a: number[], b: number[], metric: DistanceMetric): number {
    switch (metric) {
      case 'cosine':
        return this.cosineSim(a, b);
      case 'euclidean':
        return 1 / (1 + this.euclideanDist(a, b));
      case 'dot_product':
        return this.dotProduct(a, b);
      default:
        return 0;
    }
  }

  private cosineSim(a: number[], b: number[]): number {
    let dot = 0, magA = 0, magB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      magA += a[i] ** 2;
      magB += b[i] ** 2;
    }
    const denom = Math.sqrt(magA) * Math.sqrt(magB);
    return denom === 0 ? 0 : dot / denom;
  }

  private euclideanDist(a: number[], b: number[]): number {
    let sum = 0;
    for (let i = 0; i < a.length; i++) {
      sum += (a[i] - b[i]) ** 2;
    }
    return Math.sqrt(sum);
  }

  private dotProduct(a: number[], b: number[]): number {
    let sum = 0;
    for (let i = 0; i < a.length; i++) {
      sum += a[i] * b[i];
    }
    return sum;
  }

  private matchFilter(metadata: Record<string, unknown>, filter: Record<string, unknown>): boolean {
    for (const [key, value] of Object.entries(filter)) {
      if (metadata[key] !== value) return false;
    }
    return true;
  }
}
