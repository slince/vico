// @vico/agent - InMemoryVectorStore: 基于数组和余弦相似度的内存版向量存储
import type { VectorStore } from '../types.js';
import type { MemoryRecord } from '../types.js';

/** 基于数组和余弦相似度的内存版向量存储 */
export class InMemoryVectorStore implements VectorStore {
  private records: MemoryRecord[] = [];

  async add(record: MemoryRecord): Promise<void> {
    this.records.push(record);
  }

  async search(embedding: number[], limit: number): Promise<MemoryRecord[]> {
    // 过滤无 embedding 的记录，计算余弦相似度
    const scored = this.records
      .filter((r) => r.embedding && r.embedding.length > 0)
      .map((r) => ({
        record: r,
        score: this.cosineSimilarity(embedding, r.embedding!),
      }))
      // 按分数降序排列
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    return scored.map((s) => s.record);
  }

  async update(id: string, patch: Partial<MemoryRecord>): Promise<void> {
    const idx = this.records.findIndex((r) => r.id === id);
    if (idx !== -1) Object.assign(this.records[idx], patch);
  }

  async delete(id: string): Promise<void> {
    const idx = this.records.findIndex((r) => r.id === id);
    if (idx !== -1) this.records.splice(idx, 1);
  }

  /** 计算两个向量的余弦相似度，零向量保护 */
  private cosineSimilarity(a: number[], b: number[]): number {
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] ** 2;
      normB += b[i] ** 2;
    }

    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    return denom === 0 ? 0 : dotProduct / denom;
  }
}
