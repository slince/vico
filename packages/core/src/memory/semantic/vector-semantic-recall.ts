// @vico/core - VectorSemanticRecall: 基于 @vico/rag BatchEmbedder + VectorStore 的语义召回实现
import type {MemoryRecord, SemanticRecallMemory} from '../types.js';
import type {BatchEmbedder, VectorStore, VectorQueryResult} from '@vico/rag';
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
  /** 内存缓存 — VectorStore 无单条读取能力，update 合并需依赖它 */
  private records = new Map<string, MemoryRecord>();

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

  async search(query: string, limit = 5, scopeId?: string): Promise<MemoryRecord[]> {
    const { embeddings } = await this.embedder.doEmbed({ values: [query] });
    await this.ensureIndex(embeddings[0].length);
    const results = await this.store.query({
      indexName: INDEX,
      queryVector: embeddings[0],
      topK: limit,
      filter: scopeId ? { scopeId } : undefined,
    });
    return results.map((r) => this.toRecord(r));
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
      metadata: [this.toMetadata(record)],
    });
    this.records.set(record.id, record);
  }

  async update(id: string, patch: Partial<MemoryRecord>): Promise<void> {
    const prev = this.records.get(id);
    if (!prev) return;

    const next: MemoryRecord = { ...prev, ...patch, id };

    // content 变更必须重新嵌入，否则向量仍对应旧 content
    let embedding = patch.embedding;
    if (patch.content !== undefined) {
      const { embeddings } = await this.embedder.doEmbed({ values: [patch.content] });
      embedding = embeddings[0];
    }
    embedding = embedding ?? prev.embedding;
    if (!embedding) return;

    await this.store.deleteVectors({ indexName: INDEX, ids: [id] });
    await this.ensureIndex(embedding.length);
    await this.store.upsert({
      indexName: INDEX,
      vectors: [embedding],
      ids: [id],
      metadata: [this.toMetadata(next)],
    });
    this.records.set(id, next);
  }

  async delete(id: string): Promise<void> {
    await this.store.deleteVectors({ indexName: INDEX, ids: [id] });
    this.records.delete(id);
  }

  /** 将 MemoryRecord 序列化为向量存储 metadata（scopeId 用于用户级隔离） */
  private toMetadata(record: MemoryRecord): Record<string, unknown> {
    return {
      content: record.content,
      threadId: record.threadId,
      scopeId: record.scopeId,
      createdAt: record.createdAt,
      ...record.metadata,
    };
  }

  /** 将向量查询结果还原为 MemoryRecord */
  private toRecord(r: VectorQueryResult): MemoryRecord {
    return {
      id: r.id,
      content: r.metadata.content as string ?? '',
      threadId: r.metadata.threadId as string | undefined,
      scopeId: r.metadata.scopeId as string | undefined,
      createdAt: r.metadata.createdAt as number ?? Date.now(),
      metadata: r.metadata as Record<string, unknown>,
    };
  }
}
