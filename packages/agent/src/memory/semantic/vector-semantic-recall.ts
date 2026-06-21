// @vico/agent - VectorSemanticRecall: 基于 @vico/rag BatchEmbedder + VectorStore 的语义召回实现
import type {MemoryRecord, SemanticRecallMemory} from '../types.js';
import type {BatchEmbedder, VectorStore} from '@vico/rag';
import {InMemoryVectorStore} from '@vico/rag';

const INDEX = 'memory';

/** VectorSemanticRecall 构造选项 */
export interface VectorSemanticRecallOptions {
  /** 批量嵌入器，将文本转换为向量 */
  embedder: BatchEmbedder;
  /** 向量存储，未提供时使用 @vico/rag 的 InMemoryVectorStore */
  vectorStore?: VectorStore;
}

/** 基于 BatchEmbedder + VectorStore 的语义召回实现 */
export class VectorSemanticRecall implements SemanticRecallMemory {
  private readonly embedder: BatchEmbedder;
  private store: VectorStore;
  private ready = false;

  constructor(options: VectorSemanticRecallOptions) {
    this.embedder = options.embedder;
    this.store = options.vectorStore ?? new InMemoryVectorStore();
  }

  private async ensureIndex(dimension: number): Promise<void> {
    if (!this.ready) {
      await this.store.createIndex({ indexName: INDEX, dimension, metric: 'cosine' });
      this.ready = true;
    }
  }

  async search(query: string, limit = 5): Promise<MemoryRecord[]> {
    const { embeddings } = await this.embedder.doEmbed({ values: [query] });
    await this.ensureIndex(embeddings[0].length);
    const results = await this.store.query({
      indexName: INDEX,
      queryVector: embeddings[0],
      topK: limit,
    });
    return results.map((r) => ({
      id: r.id,
      content: r.metadata.content as string ?? '',
      threadId: r.metadata.threadId as string | undefined,
      createdAt: r.metadata.createdAt as number ?? Date.now(),
      metadata: r.metadata as Record<string, unknown>,
    }));
  }

  async create(record: MemoryRecord): Promise<void> {
    let embedding = record.embedding;
    if (!embedding) {
      const { embeddings } = await this.embedder.doEmbed({ values: [record.content] });
      embedding = embeddings[0];
    }
    await this.ensureIndex(embedding.length);
    await this.store.upsert({
      indexName: INDEX,
      vectors: [embedding],
      ids: [record.id],
      metadata: [{
        content: record.content,
        threadId: record.threadId,
        createdAt: record.createdAt,
        ...record.metadata,
      }],
    });
  }

  async update(id: string, patch: Partial<MemoryRecord>): Promise<void> {
    let embedding = patch.embedding;
    if (patch.content !== undefined && !embedding) {
      const { embeddings } = await this.embedder.doEmbed({ values: [patch.content] });
      embedding = embeddings[0];
    }
    // rag VectorStore 不支持部分更新，先删后加
    await this.store.deleteVectors({ indexName: INDEX, ids: [id] });
    if (embedding) {
      await this.ensureIndex(embedding.length);
      await this.store.upsert({
        indexName: INDEX,
        vectors: [embedding],
        ids: [id],
        metadata: [{
          content: patch.content ?? '',
          threadId: patch.threadId,
          createdAt: patch.createdAt,
          ...patch.metadata,
        }],
      });
    }
  }

  async delete(id: string): Promise<void> {
    await this.store.deleteVectors({ indexName: INDEX, ids: [id] });
  }
}
