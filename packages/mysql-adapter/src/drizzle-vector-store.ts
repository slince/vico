// @vico/mysql-adapter — MySQL/Drizzle-backed VectorStore implementation
import { eq, desc, and } from 'drizzle-orm';
import type { MySql2Database } from 'drizzle-orm/mysql2';
import type { VectorStore, MemoryRecord } from '@vico/agent';
import { memoryEntries } from './schema.js';
import type * as schema from './schema.js';

/** DrizzleVectorStore construction options */
export interface DrizzleVectorStoreOptions {
  /** Drizzle MySQL database instance (schema must include this package's tables) */
  db: MySql2Database<typeof schema>;
  /** Optional: scope filter for retrieval */
  scopeType?: 'user' | 'workspace';
  scopeId?: string;
}

/**
 * MySQL/Drizzle-based vector store implementation.
 * search() fetches all semantic records, computes cosine similarity in JS.
 * Suitable for small-to-medium data (thousands of records).
 */
export class DrizzleVectorStore implements VectorStore {
  private db: MySql2Database<typeof schema>;
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
      embedding: record.embedding,
      metadata: record.metadata ?? {},
      importance: 0,
      created_at: record.createdAt,
    });
  }

  async search(embedding: number[], limit: number): Promise<MemoryRecord[]> {
    // Build conditions in one shot to avoid Drizzle type chain loss
    const conditions = this.filterScope
      ? and(
          eq(memoryEntries.type, 'semantic'),
          eq(memoryEntries.scope_type, this.scopeType),
          eq(memoryEntries.scope_id, this.scopeId),
        )
      : eq(memoryEntries.type, 'semantic');

    // Take most recent N records by time as candidate set,
    // to control cosine similarity computation cost
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
          embedding: number[];
        } => r.embedding !== null,
      )
      .map((r) => ({
        record: this._toMemoryRecord(r),
        score: this._cosineSimilarity(
          embedding,
          r.embedding,
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
    if (patch.embedding !== undefined) values.embedding = patch.embedding;
    if (patch.metadata !== undefined) values.metadata = patch.metadata;
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
      embedding: r.embedding as number[] | undefined,
      metadata: r.metadata as Record<string, unknown> | undefined,
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
