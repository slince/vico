// @vico/agent - RagVectorStore: wraps @vico/rag InMemoryVectorStore to agent's VectorStore interface
import { InMemoryVectorStore as RagInMemoryStore } from '@vico/rag';
import type { VectorStore } from '../types.js';
import type { MemoryRecord } from '../types.js';

const INDEX = 'memory';

/**
 * RagVectorStore — 适配 @vico/rag 的 InMemoryVectorStore 到 agent 的 VectorStore 接口。
 */
export class RagVectorStore implements VectorStore {
  private store = new RagInMemoryStore();
  private ready = false;

  private async ensureIndex(dimension: number): Promise<void> {
    if (!this.ready) {
      await this.store.createIndex({ indexName: INDEX, dimension, metric: 'cosine' });
      this.ready = true;
    }
  }

  async add(record: MemoryRecord): Promise<void> {
    if (!record.embedding) return;
    await this.ensureIndex(record.embedding.length);
    await this.store.upsert({
      indexName: INDEX,
      vectors: [record.embedding],
      ids: [record.id],
      metadata: [{
        content: record.content,
        threadId: record.threadId,
        createdAt: record.createdAt,
        ...record.metadata,
      }],
    });
  }

  async search(embedding: number[], limit: number): Promise<MemoryRecord[]> {
    await this.ensureIndex(embedding.length);
    const results = await this.store.query({
      indexName: INDEX,
      queryVector: embedding,
      topK: limit,
    });
    return results.map((r: { id: string; score: number; metadata: Record<string, unknown> }) => ({
      id: r.id,
      content: r.metadata.content as string ?? '',
      threadId: r.metadata.threadId as string | undefined,
      createdAt: r.metadata.createdAt as number ?? Date.now(),
      metadata: r.metadata as Record<string, unknown>,
      embedding: [], // 不存回，减少内存
    }));
  }

  async update(id: string, patch: Partial<MemoryRecord>): Promise<void> {
    // rag VectorStore 不支持部分更新，先删后加
    await this.store.deleteVectors({ indexName: INDEX, ids: [id] });
    if (patch.embedding) {
      const existing = patch as MemoryRecord;
      await this.add({
        id,
        content: existing.content ?? '',
        createdAt: existing.createdAt ?? Date.now(),
        embedding: existing.embedding,
        threadId: existing.threadId,
        metadata: existing.metadata,
      });
    }
  }

  async delete(id: string): Promise<void> {
    await this.store.deleteVectors({ indexName: INDEX, ids: [id] });
  }
}
