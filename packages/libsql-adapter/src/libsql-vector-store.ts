// @vico/libsql-adapter — LibSQL 原生向量存储（基于 F32_BLOB + vector_distance_cos）
import type { Client } from '@libsql/client';
import type { DistanceMetric, VectorQueryResult, VectorStore } from '@vico/rag';

/** LibSQLVectorStore 构造选项 */
export interface LibSQLVectorStoreOptions {
  /** LibSQL 原生客户端，通过 createClient() 创建 */
  client: Client;
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
 * import { LibSQLVectorStore } from '@vico/libsql-adapter';
 *
 * const client = createClient({ url: 'file:data.db' });
 * const store = new LibSQLVectorStore({ client });
 * ```
 */
export class LibSQLVectorStore implements VectorStore {
  private client: Client;
  private metrics: Map<string, DistanceMetric> = new Map();

  constructor(options: LibSQLVectorStoreOptions) {
    this.client = options.client;
  }

  /** 确保指标配置持久化表存在并加载已有配置 */
  private async ensureLoaded(): Promise<void> {
    await this.client.execute({
      sql: `CREATE TABLE IF NOT EXISTS vico_index_config (index_name TEXT PRIMARY KEY, metric TEXT NOT NULL, dimension INTEGER NOT NULL)`,
      args: [],
    });
    const { rows } = await this.client.execute({
      sql: `SELECT index_name, metric FROM vico_index_config`,
      args: [],
    });
    for (const row of rows as unknown as { index_name: string; metric: string }[]) {
      if (!this.metrics.has(row.index_name)) {
        this.metrics.set(row.index_name, row.metric as DistanceMetric);
      }
    }
  }

  async createIndex(params: {
    indexName: string;
    dimension: number;
    metric: DistanceMetric;
  }): Promise<void> {
    // 索引名会拼入 DDL，限制为安全标识符，防止 SQL 注入
    if (!/^[A-Za-z0-9_]+$/.test(params.indexName)) {
      throw new Error(`Invalid index name: ${params.indexName}`);
    }
    this.metrics.set(params.indexName, params.metric);

    // 持久化 metric，防止重启丢失
    await this.client.execute({
      sql: `INSERT OR REPLACE INTO vico_index_config (index_name, metric, dimension) VALUES (?, ?, ?)`,
      args: [params.indexName, params.metric, params.dimension],
    });

    try {
      await this.client.execute({
        sql: `CREATE INDEX IF NOT EXISTS idx_vec_${params.indexName} ON vico_memory_entries (libsql_vector_idx(embedding, 'metric=${params.metric}')) WHERE type = 'semantic' AND scope_type = '${params.indexName}'`,
        args: [],
      });
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
      await this.client.execute({
        sql: `DELETE FROM vico_memory_entries WHERE id = ?`,
        args: [id],
      });
    }

    // 使用原生 vector32() 批量插入
    for (let i = 0; i < params.ids.length; i++) {
      const meta = params.metadata[i] ?? {};
      const vecStr = JSON.stringify(params.vectors[i]);
      const metaStr = JSON.stringify(meta);
      const scopeId = (meta.scopeId as string) ?? '';

      await this.client.execute({
        sql: `INSERT INTO vico_memory_entries (id, thread_id, scope_type, scope_id, type, content, embedding, metadata, importance, created_at) VALUES (?, ?, ?, ?, 'semantic', ?, vector32(?), ?, 0, ?)`,
        args: [
          params.ids[i],
          (meta.threadId as string) ?? null,
          params.indexName,
          scopeId,
          (meta.content as string) ?? '',
          vecStr,
          metaStr,
          (meta.createdAt as number) ?? now,
        ],
      });
    }
  }

  async query(params: {
    indexName: string;
    queryVector: number[];
    topK: number;
    filter?: Record<string, unknown>;
  }): Promise<VectorQueryResult[]> {
    await this.ensureLoaded();
    const vecStr = JSON.stringify(params.queryVector);
    const metric = this.metrics.get(params.indexName) ?? 'cosine';
    const distFn = metric === 'euclidean'
      ? 'vector_distance_l2'
      : 'vector_distance_cos';

    // scopeId 单独提取为 WHERE 条件（用户级隔离），其余 filter 走 post-filter
    const scopeId = params.filter?.scopeId as string | undefined;
    const restFilter = params.filter
      ? Object.fromEntries(Object.entries(params.filter).filter(([k]) => k !== 'scopeId'))
      : undefined;

    let sql = `SELECT id, content, metadata, thread_id, scope_type, created_at, ${distFn}(embedding, vector32(?)) AS _distance FROM vico_memory_entries WHERE scope_type = ? AND type = 'semantic' AND embedding IS NOT NULL`;
    const args: any[] = [vecStr, params.indexName];
    if (scopeId !== undefined) {
      sql += ` AND scope_id = ?`;
      args.push(scopeId);
    }
    sql += ` ORDER BY _distance ASC LIMIT ?`;
    args.push(params.topK);

    const { rows } = await this.client.execute({ sql, args });

    return (rows as unknown as Record<string, unknown>[])
      .map((r) => {
        let meta: Record<string, unknown> = {};
        try {
          meta = typeof r.metadata === 'string'
            ? JSON.parse(r.metadata as string)
            : (r.metadata as Record<string, unknown>);
        } catch { /* keep empty */ }

        // 元数据过滤（post-filter）
        if (restFilter && !matchFilter(meta, restFilter)) return null;

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
      await this.client.execute({
        sql: `DELETE FROM vico_memory_entries WHERE id = ? AND scope_type = ?`,
        args: [id, params.indexName],
      });
    }
  }

  async dropIndex(indexName: string): Promise<void> {
    this.metrics.delete(indexName);
    await this.client.execute({
      sql: `DELETE FROM vico_index_config WHERE index_name = ?`,
      args: [indexName],
    });
    await this.client.execute({
      sql: `DELETE FROM vico_memory_entries WHERE scope_type = ?`,
      args: [indexName],
    });
  }
}

/** 精确匹配元数据过滤 */
function matchFilter(metadata: Record<string, unknown>, filter: Record<string, unknown>): boolean {
  for (const [key, value] of Object.entries(filter)) {
    if (metadata[key] !== value) return false;
  }
  return true;
}
