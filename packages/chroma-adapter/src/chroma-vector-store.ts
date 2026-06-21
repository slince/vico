// @vico/chroma — Chroma-backed VectorStore implementation
import type { ChromaClient, Collection, Metadata } from 'chromadb';
import type { VectorStore, MemoryRecord } from '@vico/agent';

/** ChromaVectorStore 构造选项 */
export interface ChromaVectorStoreOptions {
  /** ChromaClient 实例 */
  client: ChromaClient;
  /** 集合名称（不存在时自动创建） */
  collectionName: string;
}

/**
 * 基于 Chroma 的向量存储实现。
 * 每个 ChromaVectorStore 实例对应一个 Chroma collection。
 *
 * @example
 * ```ts
 * import { ChromaClient } from 'chromadb';
 * import { ChromaVectorStore } from '@vico/chroma';
 *
 * const client = new ChromaClient({ path: 'http://localhost:8000' });
 * const store = new ChromaVectorStore({ client, collectionName: 'memories' });
 * ```
 */
export class ChromaVectorStore implements VectorStore {
  private client: ChromaClient;
  private collectionName: string;
  private collection: Collection | null = null;

  constructor(options: ChromaVectorStoreOptions) {
    this.client = options.client;
    this.collectionName = options.collectionName;
  }

  /** 懒加载获取 collection，不存在时自动创建 */
  private async _getCollection(): Promise<Collection> {
    if (this.collection) return this.collection;

    try {
      this.collection = await this.client.getCollection({
        name: this.collectionName,
      });
    } catch {
      this.collection = await this.client.createCollection({
        name: this.collectionName,
        metadata: { 'hnsw:space': 'cosine' },
      });
    }
    return this.collection;
  }

  async add(record: MemoryRecord): Promise<void> {
    if (!record.embedding) {
      throw new Error('ChromaVectorStore.add() requires an embedding');
    }

    const collection = await this._getCollection();
    await collection.add({
      ids: [record.id],
      embeddings: [record.embedding],
      documents: [record.content],
      metadatas: [this._toMetadata(record)],
    });
  }

  async search(
    embedding: number[],
    limit: number,
  ): Promise<MemoryRecord[]> {
    const collection = await this._getCollection();
    const results = await collection.query({
      queryEmbeddings: [embedding],
      nResults: limit,
      include: ['embeddings', 'documents', 'metadatas'],
    });

    // rows() 返回二维数组（一个子数组对应一个查询），取第一个查询结果
    const rows = results.rows()[0] ?? [];
    return rows.map((row) => this._toMemoryRecord(row));
  }

  async update(
    id: string,
    patch: Partial<MemoryRecord>,
  ): Promise<void> {
    const collection = await this._getCollection();

    // 先查当前值，再合并 patch
    const existing = await collection.get({
      ids: [id],
      include: ['embeddings', 'documents', 'metadatas'],
    });

    const currentEmbedding = existing.embeddings?.[0] ?? undefined;
    const currentDocument = existing.documents?.[0] ?? '';
    const currentMetadata = existing.metadatas?.[0] ?? {};

    // 合并 patch 到 metadata
    const mergedMetadata: Record<string, unknown> = {
      threadId: (currentMetadata.threadId as string) ?? '',
      createdAt: (currentMetadata.createdAt as number) ?? 0,
    };
    if (patch.threadId !== undefined) mergedMetadata.threadId = patch.threadId;
    if (patch.createdAt !== undefined) mergedMetadata.createdAt = patch.createdAt;

    await collection.update({
      ids: [id],
      embeddings: patch.embedding
        ? [patch.embedding]
        : currentEmbedding
          ? [currentEmbedding]
          : undefined,
      documents: patch.content ? [patch.content] : [currentDocument],
      metadatas: [mergedMetadata as Metadata],
    });
  }

  async delete(id: string): Promise<void> {
    const collection = await this._getCollection();
    await collection.delete({ ids: [id] });
  }

  // --- Private helpers ---

  /** 将 MemoryRecord 编码为 Chroma Metadata */
  private _toMetadata(record: MemoryRecord): Metadata {
    return {
      threadId: record.threadId ?? '',
      createdAt: record.createdAt,
      ...(record.metadata as Record<string, string | number | boolean> | undefined ?? {}),
    };
  }

  /** 将 Chroma 查询行还原为 MemoryRecord */
  private _toMemoryRecord(
    row: {
      id: string;
      document?: string | null;
      embedding?: number[] | null;
      metadata?: Metadata | null;
    },
  ): MemoryRecord {
    return {
      id: row.id,
      content: row.document ?? '',
      embedding: row.embedding ?? undefined,
      metadata: row.metadata ? (row.metadata as Record<string, unknown>) : {},
      threadId: (row.metadata?.threadId as string) ?? undefined,
      createdAt: (row.metadata?.createdAt as number) ?? 0,
    };
  }
}
