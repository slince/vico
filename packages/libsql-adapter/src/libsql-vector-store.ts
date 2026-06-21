// @vico/libsql-adapter — LibSQL 原生向量存储（基于 F32_BLOB + vector_distance_cos）
import {eq, sql} from 'drizzle-orm';
import type {LibSQLDatabase} from 'drizzle-orm/libsql';
import type {DistanceMetric, VectorQueryResult, VectorStore} from '@vico/rag';
import type * as schema from './schema.js';
import {memoryEntries} from './schema.js';

/** LibSQLVectorStore 构造选项 */
export interface LibSQLVectorStoreOptions {
  /** Drizzle libSQL 数据库实例 */
  db: LibSQLDatabase<typeof schema>;
}

/**
 * 基于 LibSQL 原生向量检索的 VectorStore 实现。
 *
 * - 存储: F32_BLOB(1536) + vector32() 函数
 * - 精确检索: vector_distance_cos / vector_distance_l2
 * - 近似检索: vector_top_k + libsql_vector_idx 索引（可选）
 *
 * @example
 * ```ts
 * import { createClient } from '@libsql/client';
 * import { drizzle } from 'drizzle-orm/libsql';
 * import { LibSQLVectorStore } from '@vico/libsql-adapter';
 *
 * const client = createClient({ url: 'file:data.db' });
 * const db = drizzle(client);
 * const store = new LibSQLVectorStore({ db });
 * ```
 */
export class LibSQLVectorStore implements VectorStore {
  private db: LibSQLDatabase<typeof schema>;
  private metrics: Map<string, DistanceMetric> = new Map();

  constructor(options: LibSQLVectorStoreOptions) {
    this.db = options.db;
  }

  async createIndex(params: {
    indexName: string;
    dimension: number;
    metric: DistanceMetric;
  }): Promise<void> {
    // 记录 metric，供 query 选择距离函数
    this.metrics.set(params.indexName, params.metric);

    // 创建 ANN 向量索引（libsql_vector_idx）
    // 用 try/catch 处理索引已存在的场景
    try {
      await this.db.run(sql`
        CREATE INDEX IF NOT EXISTS ${sql.raw(`idx_vec_${params.indexName}`)}
        ON vico_memory_entries (libsql_vector_idx(embedding, ${sql.raw(`'metric=${params.metric}'`)}))
        WHERE type = 'semantic' AND scope_type = ${params.indexName}
      `);
    } catch {
      // 索引已存在，忽略
    }
  }

  async upsert(params: {
    indexName: string;
    vectors: number[][];
    ids: string[];
    metadata: Record<string, unknown>[];
  }): Promise<void> {
    const now = Date.now();

    // 先批量删除同 ID 旧记录
    for (const id of params.ids) {
      await this.db.delete(memoryEntries).where(eq(memoryEntries.id, id));
    }

    // 使用原生 vector32() 批量插入
    for (let i = 0; i < params.ids.length; i++) {
      const meta = params.metadata[i] ?? {};
      const vecStr = JSON.stringify(params.vectors[i]);
      const metaStr = JSON.stringify(meta);

      await this.db.run(sql`
        INSERT INTO vico_memory_entries
          (id, thread_id, scope_type, scope_id, type, content, embedding, metadata, importance, created_at)
        VALUES
          (${params.ids[i]}, ${(meta.threadId as string) ?? null}, ${params.indexName}, '', 'semantic',
           ${(meta.content as string) ?? ''}, vector32(${vecStr}), ${metaStr}, 0, ${(meta.createdAt as number) ?? now})
      `);
    }
  }

  async query(params: {
    indexName: string;
    queryVector: number[];
    topK: number;
    filter?: Record<string, unknown>;
  }): Promise<VectorQueryResult[]> {
    const vecStr = JSON.stringify(params.queryVector);
    const metric = this.metrics.get(params.indexName) ?? 'cosine';
    const distFn = metric === 'euclidean'
      ? sql`vector_distance_l2`
      : sql`vector_distance_cos`;

    // 使用原生向量距离函数，在 SQL 层排序
    const rows = this.db.all(sql`
      SELECT id, content, metadata, thread_id, scope_type, created_at,
        ${distFn}(embedding, vector32(${vecStr})) AS _distance
      FROM vico_memory_entries
      WHERE scope_type = ${params.indexName}
        AND type = 'semantic'
        AND embedding IS NOT NULL
      ORDER BY _distance ASC
      LIMIT ${params.topK}
    `) as unknown as Record<string, unknown>[];

    return rows
      .map((r) => {
        let meta: Record<string, unknown> = {};
        try {
          meta = typeof r.metadata === 'string'
            ? JSON.parse(r.metadata as string)
            : (r.metadata as Record<string, unknown>);
        } catch { /* keep empty */ }

        // 元数据过滤（post-filter）
        if (params.filter && !matchFilter(meta, params.filter)) return null;

        // 距离转相似度分数（距离越小 → 分数越高）
        const distance = r._distance as number;
        const score = metric === 'euclidean'
          ? 1 / (1 + distance)
          : 1 - distance;

        return { id: r.id as string, score, metadata: meta };
      })
      .filter((v): v is VectorQueryResult => v !== null);
  }

  async deleteVectors(params: {
    indexName: string;
    ids: string[];
  }): Promise<void> {
    for (const id of params.ids) {
      await this.db
        .delete(memoryEntries)
        .where(sql`${memoryEntries.id} = ${id} AND ${memoryEntries.scope_type} = ${params.indexName}`);
    }
  }

  async dropIndex(indexName: string): Promise<void> {
    this.metrics.delete(indexName);
    await this.db
      .delete(memoryEntries)
      .where(eq(memoryEntries.scope_type, indexName));
  }
}

/** 精确匹配元数据过滤 */
function matchFilter(metadata: Record<string, unknown>, filter: Record<string, unknown>): boolean {
  for (const [key, value] of Object.entries(filter)) {
    if (metadata[key] !== value) return false;
  }
  return true;
}
