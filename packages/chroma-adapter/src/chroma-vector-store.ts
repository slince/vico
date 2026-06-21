// @vico/chroma — Chroma-backed VectorStore (implements @vico/rag VectorStore)
import type { ChromaClient, Collection, Metadata, Where } from 'chromadb';
import type { VectorStore, DistanceMetric, VectorQueryResult } from '@vico/rag';

/** ChromaVectorStore 构造选项 */
export interface ChromaVectorStoreOptions {
  /** ChromaClient 实例 */
  client: ChromaClient;
  /** 集合名称前缀，默认 'vico'。索引名会映射为 `${namespace}_${indexName}` */
  namespace?: string;
}

/** 单个索引的缓存条目 */
interface IndexEntry {
  collection: Collection;
  metric: DistanceMetric;
}

/**
 * 基于 Chroma 的向量存储实现，实现 @vico/rag 的 VectorStore 接口。
 *
 * 每个 RAG indexName 映射为一个 Chroma collection（名称：`${namespace}_${indexName}`），
 * 支持 lazily 创建和缓存的 collection 管理。
 *
 * @example
 * ```ts
 * import { ChromaClient } from 'chromadb';
 * import { ChromaVectorStore } from '@vico/chroma-adapter';
 *
 * const client = new ChromaClient({ path: 'http://localhost:8000' });
 * const store = new ChromaVectorStore({ client });
 * ```
 */
export class ChromaVectorStore implements VectorStore {
  private client: ChromaClient;
  private namespace: string;
  private indices: Map<string, IndexEntry> = new Map();

  constructor(options: ChromaVectorStoreOptions) {
    this.client = options.client;
    this.namespace = options.namespace ?? 'vico';
  }

  /** 获取 indexName 对应的 Chroma collection 名称 */
  private collectionName(indexName: string): string {
    return `${this.namespace}_${indexName}`;
  }

  /** 获取或懒创建 collection */
  private async getCollection(
    indexName: string,
    metric?: DistanceMetric,
    dimension?: number,
  ): Promise<Collection> {
    const name = this.collectionName(indexName);
    const cached = this.indices.get(indexName);
    if (cached) return cached.collection;

    let collection: Collection;
    try {
      collection = await this.client.getCollection({ name });
    } catch {
      collection = await this.client.createCollection({
        name,
        metadata: { 'hnsw:space': chromaSpace(metric ?? 'cosine') },
      });
    }

    this.indices.set(indexName, { collection, metric: metric ?? 'cosine' });
    return collection;
  }

  // ---- VectorStore 接口实现 ----

  async createIndex(params: {
    indexName: string;
    dimension: number;
    metric: DistanceMetric;
  }): Promise<void> {
    const name = this.collectionName(params.indexName);

    // 已缓存则跳过
    if (this.indices.has(params.indexName)) return;

    let collection: Collection;
    try {
      collection = await this.client.getCollection({ name });
    } catch {
      collection = await this.client.createCollection({
        name,
        metadata: { 'hnsw:space': chromaSpace(params.metric) },
      });
    }

    this.indices.set(params.indexName, { collection, metric: params.metric });
  }

  async upsert(params: {
    indexName: string;
    vectors: number[][];
    ids: string[];
    metadata: Record<string, unknown>[];
  }): Promise<void> {
    const cached = this.indices.get(params.indexName);
    const collection = cached
      ? cached.collection
      : await this.getCollection(params.indexName);

    await collection.upsert({
      ids: params.ids,
      embeddings: params.vectors,
      metadatas: params.metadata.map(toChromaMetadata),
    });
  }

  async query(params: {
    indexName: string;
    queryVector: number[];
    topK: number;
    filter?: Record<string, unknown>;
  }): Promise<VectorQueryResult[]> {
    const cached = this.indices.get(params.indexName);
    if (!cached) return [];

    const results = await cached.collection.query({
      queryEmbeddings: [params.queryVector],
      nResults: params.topK,
      where: params.filter ? (toChromaWhere(params.filter) as Where) : undefined,
      include: ['metadatas', 'distances'],
    });

    const ids = results.ids?.[0] ?? [];
    const distances = results.distances?.[0] ?? [];
    const metadatas = results.metadatas?.[0] ?? [];

    return ids.map((id, i) => ({
      id,
      score: distanceToScore(distances[i] ?? 0, cached.metric),
      metadata: metadatas[i] ? (metadatas[i] as Record<string, unknown>) : {},
    }));
  }

  async deleteVectors(params: {
    indexName: string;
    ids: string[];
  }): Promise<void> {
    const cached = this.indices.get(params.indexName);
    if (!cached) return;

    await cached.collection.delete({ ids: params.ids });
  }

  async dropIndex(indexName: string): Promise<void> {
    const name = this.collectionName(indexName);
    this.indices.delete(indexName);

    try {
      await this.client.deleteCollection({ name });
    } catch {
      // 集合不存在则忽略
    }
  }
}

// ---- 内部工具函数 ----

/** 将 @vico/rag DistanceMetric 映射为 Chroma hnsw:space */
function chromaSpace(metric: DistanceMetric): string {
  switch (metric) {
    case 'cosine':
      return 'cosine';
    case 'euclidean':
      return 'l2';
    case 'dot_product':
      return 'ip';
    default:
      return 'cosine';
  }
}

/** 将 Chroma distance 转换为相似度分数 (0-1，越高越相似) */
function distanceToScore(distance: number, metric: DistanceMetric): number {
  switch (metric) {
    case 'cosine':
      // Chroma 余弦距离 = 1 - 余弦相似度
      return 1 - Math.max(0, Math.min(2, distance));
    case 'euclidean':
      return 1 / (1 + distance);
    case 'dot_product':
      // Chroma 内积距离 = -dot_product
      return -distance;
    default:
      return 1 - distance;
  }
}

/** 将 Record<string, unknown> 转为 Chroma Metadata 兼容格式 */
function toChromaMetadata(meta: Record<string, unknown>): Metadata {
  const out: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(meta)) {
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
      out[k] = v;
    } else if (v !== null && v !== undefined) {
      out[k] = String(v);
    }
  }
  return out;
}

/** 将简单 key-value filter 转为 Chroma where 格式 */
function toChromaWhere(filter: Record<string, unknown>): Record<string, unknown> {
  // Chroma 支持直接的 key-value 精确匹配
  const where: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(filter)) {
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
      where[k] = v;
    }
  }
  return where;
}
