/**
 * Memory + Vector 初始化（不再依赖 Mastra）。
 *
 * 提供：
 * - getVector() — 基于 @libsql/client 的向量存储
 * - getStorage() — 存储单例（兼容旧接口，返回 null）
 */
import {createClient} from '@libsql/client';
import {getDatabaseUrl} from '../db/init-libsql.js';

let _vectorStore: any;

export function getVector(): any {
  if (!_vectorStore) {
    _vectorStore = {
      createIndex: async (opts: any) => {
        const client = createClient({ url: getDatabaseUrl() });
        const sql = `CREATE TABLE IF NOT EXISTS ${opts.indexName} (
          vector_id TEXT PRIMARY KEY,
          vector BLOB NOT NULL,
          metadata TEXT
        )`;
        await client.execute({ sql, args: [] });
        // 创建向量索引
        try {
          await client.execute({
            sql: `CREATE INDEX IF NOT EXISTS idx_${opts.indexName}_vector ON ${opts.indexName}(libsql_vector_idx(vector))`,
            args: [],
          });
        } catch {}
      },
      upsert: async (opts: any) => {
        const client = createClient({ url: getDatabaseUrl() });
        const { indexName, vectors, ids, metadata } = opts;
        for (let i = 0; i < ids.length; i++) {
          const blob = Buffer.from(new Float32Array(vectors[i]).buffer);
          const meta = metadata[i] ? JSON.stringify(metadata[i]) : '{}';
          await client.execute({
            sql: `INSERT OR REPLACE INTO ${indexName} (vector_id, vector, metadata) VALUES (?, vector32(?), ?)`,
            args: [ids[i], blob.toString('hex'), meta],
          });
        }
      },
      query: async (opts: any) => {
        const client = createClient({ url: getDatabaseUrl() });
        const { indexName, queryVector, topK } = opts;
        const blob = Buffer.from(new Float32Array(queryVector).buffer);
        try {
          const { rows } = await client.execute({
            sql: `SELECT vector_id, vector_distance_cos(vector, vector32(?)) as score, metadata FROM ${indexName} ORDER BY score ASC LIMIT ?`,
            args: [blob.toString('hex'), topK],
          });
          return rows.map((r: any) => ({
            id: r.vector_id,
            score: 1 - (r.score as number),
            metadata: r.metadata ? JSON.parse(r.metadata as string) : {},
          }));
        } catch {
          // Fallback: 无向量索引时的简化查询
          const { rows } = await client.execute({
            sql: `SELECT vector_id, metadata FROM ${indexName} LIMIT ?`,
            args: [topK],
          });
          return rows.map((r: any) => ({
            id: r.vector_id,
            score: 0.5,
            metadata: r.metadata ? JSON.parse(r.metadata as string) : {},
          }));
        }
      },
      deleteVectors: async (opts: any) => {
        const client = createClient({ url: getDatabaseUrl() });
        for (const id of opts.ids) {
          await client.execute({
            sql: `DELETE FROM ${opts.indexName} WHERE vector_id = ?`,
            args: [id],
          });
        }
      },
    };
  }
  return _vectorStore;
}
