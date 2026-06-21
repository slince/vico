// @vico/libsql-adapter — LibSQL/Drizzle-backed VectorStore (implements @vico/rag VectorStore)
import { eq, and, desc } from 'drizzle-orm';
import type { LibSQLDatabase } from 'drizzle-orm/libsql';
import type { VectorStore, DistanceMetric, VectorQueryResult } from '@vico/rag';
import { memoryEntries } from './schema.js';
import type * as schema from './schema.js';

/** DrizzleVectorStore 构造选项 */
export interface DrizzleVectorStoreOptions {
  /** Drizzle libSQL 数据库实例（schema 需包含本包的 memoryEntries 表） */
  db: LibSQLDatabase<typeof schema>;
}

/**
 * 基于 LibSQL/Drizzle 的向量存储实现，实现 @vico/rag 的 VectorStore 接口。
 *
 * 每个 RAG indexName 映射为 memoryEntries 表中 scope_type 字段的一个取值。
 * 向量以 JSON 文本存储在 embedding 列，查询时在 JS 侧计算余弦/欧氏/内积相似度。
 *
 * @example
 * ```ts
 * import { createClient } from '@libsql/client';
 * import { drizzle } from 'drizzle-orm/libsql';
 * import { DrizzleVectorStore } from '@vico/libsql-adapter';
 *
 * const client = createClient({ url: 'file:data.db' });
 * const db = drizzle(client);
 * const store = new DrizzleVectorStore({ db });
 * ```
 */
export class DrizzleVectorStore implements VectorStore {
  private db: LibSQLDatabase<typeof schema>;
  /** 记录每个 index 使用的相似度度量，供 distance→score 转换 */
  private metrics: Map<string, DistanceMetric> = new Map();

  constructor(options: DrizzleVectorStoreOptions) {
    this.db = options.db;
  }

  /** 候选集上限，控制相似度计算开销 */
  private static readonly CANDIDATE_LIMIT = 500;

  // ---- VectorStore 接口实现 ----

  async createIndex(params: {
    indexName: string;
    dimension: number;
    metric: DistanceMetric;
  }): Promise<void> {
    // 表已通过 migration 存在，仅记录 metric 供后续查询使用
    if (!this.metrics.has(params.indexName)) {
      this.metrics.set(params.indexName, params.metric);
    }
  }

  async upsert(params: {
    indexName: string;
    vectors: number[][];
    ids: string[];
    metadata: Record<string, unknown>[];
  }): Promise<void> {
    const now = Date.now();

    // 先批量删除同 ID 旧记录，再批量插入
    for (const id of params.ids) {
      await this.db.delete(memoryEntries).where(eq(memoryEntries.id, id));
    }

    const rows = params.ids.map((id, i) => {
      const meta = params.metadata[i] ?? {};
      return {
        id,
        thread_id: (meta.threadId as string) ?? null,
        scope_type: params.indexName,
        scope_id: '',
        type: 'semantic' as const,
        content: (meta.content as string) ?? '',
        embedding: JSON.stringify(params.vectors[i]),
        metadata: JSON.stringify(meta),
        importance: 0,
        created_at: (meta.createdAt as number) ?? now,
      };
    });

    if (rows.length > 0) {
      await this.db.insert(memoryEntries).values(rows);
    }
  }

  async query(params: {
    indexName: string;
    queryVector: number[];
    topK: number;
    filter?: Record<string, unknown>;
  }): Promise<VectorQueryResult[]> {
    const rows = await this.db
      .select()
      .from(memoryEntries)
      .where(
        and(
          eq(memoryEntries.scope_type, params.indexName),
          eq(memoryEntries.type, 'semantic'),
        ),
      )
      .orderBy(desc(memoryEntries.created_at))
      .limit(DrizzleVectorStore.CANDIDATE_LIMIT);

    const metric = this.metrics.get(params.indexName) ?? 'cosine';

    return rows
      .filter((r): r is typeof memoryEntries.$inferSelect & { embedding: string } => r.embedding !== null)
      .map((r) => {
        let vector: number[];
        try {
          vector = JSON.parse(r.embedding) as number[];
        } catch {
          return null;
        }
        let meta: Record<string, unknown>;
        try {
          meta = JSON.parse(r.metadata) as Record<string, unknown>;
        } catch {
          meta = {};
        }
        // 元数据过滤
        if (params.filter && !matchFilter(meta, params.filter)) return null;
        return {
          id: r.id,
          score: similarity(params.queryVector, vector, metric),
          metadata: meta,
        };
      })
      .filter((v): v is VectorQueryResult => v !== null)
      .sort((a, b) => b.score - a.score)
      .slice(0, params.topK);
  }

  async deleteVectors(params: {
    indexName: string;
    ids: string[];
  }): Promise<void> {
    for (const id of params.ids) {
      await this.db.delete(memoryEntries).where(
        and(eq(memoryEntries.id, id), eq(memoryEntries.scope_type, params.indexName)),
      );
    }
  }

  async dropIndex(indexName: string): Promise<void> {
    this.metrics.delete(indexName);
    await this.db
      .delete(memoryEntries)
      .where(eq(memoryEntries.scope_type, indexName));
  }
}

// ---- 内部工具函数 ----

/** 计算两个向量的相似度 */
function similarity(a: number[], b: number[], metric: DistanceMetric): number {
  switch (metric) {
    case 'cosine':
      return cosineSim(a, b);
    case 'euclidean':
      return 1 / (1 + euclideanDist(a, b));
    case 'dot_product':
      return dotProduct(a, b);
    default:
      return 0;
  }
}

function cosineSim(a: number[], b: number[]): number {
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] ** 2;
    magB += b[i] ** 2;
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
}

function euclideanDist(a: number[], b: number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    sum += (a[i] - b[i]) ** 2;
  }
  return Math.sqrt(sum);
}

function dotProduct(a: number[], b: number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    sum += a[i] * b[i];
  }
  return sum;
}

/** 精确匹配元数据过滤 */
function matchFilter(metadata: Record<string, unknown>, filter: Record<string, unknown>): boolean {
  for (const [key, value] of Object.entries(filter)) {
    if (metadata[key] !== value) return false;
  }
  return true;
}
