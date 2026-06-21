// @vico/db-adapter — Drizzle-backed VectorStore implementation
import { eq, desc, and } from 'drizzle-orm';
import type { LibSQLDatabase } from 'drizzle-orm/libsql';
import type { VectorStore, MemoryRecord } from '@vico/agent';
import { memoryEntries } from './schema.js';
import type * as schema from './schema.js';

/** DrizzleVectorStore 构造选项 */
export interface DrizzleVectorStoreOptions {
  /** Drizzle LibSQL 数据库实例（schema 需包含本包的表） */
  db: LibSQLDatabase<typeof schema>;
  /** 可选：限定检索范围 */
  scopeType?: 'user' | 'workspace';
  scopeId?: string;
}

/**
 * 基于 Drizzle + LibSQL 的向量存储实现。
 * search() 会查出全量 semantic 记录，在 JS 侧计算余弦相似度，
 * 适用于中小规模数据（数千条）；大规模场景建议使用 Turso 原生向量索引。
 */
export class DrizzleVectorStore implements VectorStore {
  private db: LibSQLDatabase<typeof schema>;
  private filterScope: boolean;
  private scopeType: string;
  private scopeId: string;

  constructor(options: DrizzleVectorStoreOptions) {
    this.db = options.db;
    this.filterScope = options.scopeType !== undefined && options.scopeId !== undefined;
    this.scopeType = options.scopeType ?? '';
    this.scopeId = options.scopeId ?? '';
  }

  async add(record: MemoryRecord): Promise<void> {
    await this.db.insert(memoryEntries).values({
      id: record.id,
      thread_id: record.threadId ?? null,
      scope_type: 'user',
      scope_id: '',
      type: 'semantic',
      content: record.content,
      embedding: record.embedding ? JSON.stringify(record.embedding) : null,
      metadata: record.metadata ? JSON.stringify(record.metadata) : '{}',
      importance: 0,
      created_at: record.createdAt,
    });
  }

  async search(embedding: number[], limit: number): Promise<MemoryRecord[]> {
    // 一次性构建条件，避免三元/let 导致 Drizzle 类型链丢失
    const conditions = this.filterScope
      ? and(
          eq(memoryEntries.type, 'semantic'),
          eq(memoryEntries.scope_type, this.scopeType),
          eq(memoryEntries.scope_id, this.scopeId),
        )
      : eq(memoryEntries.type, 'semantic');

    // 按时间倒序取最近 N 条作为候选集，控制 cosine similarity 计算量
    const rows = await this.db
      .select()
      .from(memoryEntries)
      .where(conditions)
      .orderBy(desc(memoryEntries.created_at))
      .limit(500);

    const scored = rows
      .filter(
        (
          r: typeof memoryEntries.$inferSelect,
        ): r is typeof memoryEntries.$inferSelect & {
          embedding: string;
        } => r.embedding !== null,
      )
      .map((r) => ({
        record: this._toMemoryRecord(r),
        score: this._cosineSimilarity(
          embedding,
          JSON.parse(r.embedding) as number[],
        ),
      }))
      .sort(
        (
          a: { score: number },
          b: { score: number },
        ) => b.score - a.score,
      )
      .slice(0, limit);

    return scored.map(
      (s: { record: MemoryRecord }) => s.record,
    );
  }

  async update(id: string, patch: Partial<MemoryRecord>): Promise<void> {
    const values: Record<string, unknown> = {};
    if (patch.content !== undefined) values.content = patch.content;
    if (patch.embedding !== undefined) {
      values.embedding = JSON.stringify(patch.embedding);
    }
    if (patch.metadata !== undefined) {
      values.metadata = JSON.stringify(patch.metadata);
    }
    if (Object.keys(values).length === 0) return;
    await this.db
      .update(memoryEntries)
      .set(values)
      .where(eq(memoryEntries.id, id));
  }

  async delete(id: string): Promise<void> {
    await this.db.delete(memoryEntries).where(eq(memoryEntries.id, id));
  }

  // --- Private helpers ---

  private _toMemoryRecord(
    r: typeof memoryEntries.$inferSelect,
  ): MemoryRecord {
    return {
      id: r.id,
      threadId: r.thread_id ?? undefined,
      content: r.content,
      embedding: r.embedding
        ? (JSON.parse(r.embedding) as number[])
        : undefined,
      metadata: r.metadata
        ? (JSON.parse(r.metadata) as Record<string, unknown>)
        : undefined,
      createdAt: r.created_at,
    };
  }

  private _cosineSimilarity(a: number[], b: number[]): number {
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
