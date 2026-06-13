/**
 * @deprecated Phase 3 upgraded: WorkingMemory uses searchByType/upsertByContent
 * for structured user facts. The vector-based retrieve() method is retained
 * for semantic similarity search in both legacy and enhanced pipelines.
 */
import { v4 as uuid } from 'uuid';
import { getSqlite } from '../db/db.js';
import { getEmbedder, float32ToBlob, blobToFloat32, cosineSimilarity } from './embedder.js';
import { config } from '../config.js';

export interface MemoryEntry {
  id: string;
  tenant_id: string;
  user_id: string;
  type: 'fact' | 'preference' | 'summary' | 'decision' | 'working' | 'observation';
  content: string;
  embedding: Float32Array | null;
  importance: number;
  created_at: number;
  expires_at: number | null;
}

class LongTermMemory {
  async store(
    tenantId: string,
    userId: string,
    content: string,
    type: 'fact' | 'preference' | 'summary' | 'decision' = 'fact',
    importance = 0.5
  ): Promise<void> {
    const db = getSqlite();
    const embedder = await getEmbedder();
    const embedding = await embedder.embed(content);

    db.prepare(`INSERT INTO memory_entries (id, tenant_id, user_id, type, content, embedding, importance, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
      uuid(), tenantId, userId, type, content, float32ToBlob(embedding), importance, Date.now()
    );
  }

  async retrieve(tenantId: string, userId: string, query: string, topK = 5): Promise<MemoryEntry[]> {
    const db = getSqlite();
    const embedder = await getEmbedder();
    const queryEmb = await embedder.embed(query);

    const rows = db.prepare(
      'SELECT * FROM memory_entries WHERE tenant_id = ? AND user_id = ? ORDER BY created_at DESC LIMIT 500'
    ).all(tenantId, userId) as any[];

    const scored = rows
      .filter((r) => r.embedding)
      .map((r) => ({
        ...r,
        embedding: blobToFloat32(r.embedding),
        score: cosineSimilarity(queryEmb, blobToFloat32(r.embedding)),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);

    return scored;
  }

  async extractAndStore(tenantId: string, userId: string, messages: { role: string; content: string }[]): Promise<void> {
    const facts: string[] = [];
    const preferencePatterns = [
      /我(?:喜欢|偏好|习惯|想要|希望)(.+)/,
      /(?:以后|下次|将来)(.+)/,
      /我(?:是|叫|在|做)(.+)/,
    ];

    for (const msg of messages) {
      if (msg.role !== 'user') continue;
      for (const pattern of preferencePatterns) {
        const match = msg.content.match(pattern);
        if (match) {
          facts.push(msg.content.trim());
          break;
        }
      }
    }

    for (const fact of facts) {
      await this.store(tenantId, userId, fact, 'fact', 0.7);
    }

    // Prune old entries
    const db = getSqlite();
    const count = (db.prepare('SELECT COUNT(*) as c FROM memory_entries WHERE tenant_id = ? AND user_id = ?').get(tenantId, userId) as any)?.c || 0;
    if (count > config.memory.ltm_max_entries) {
      db.prepare('DELETE FROM memory_entries WHERE id IN (SELECT id FROM memory_entries WHERE tenant_id = ? AND user_id = ? ORDER BY created_at ASC LIMIT ?)').run(
        tenantId, userId, Math.floor(config.memory.ltm_max_entries * 0.1)
      );
    }
  }

  /**
   * 按类型检索记忆条目
   * 从 memory_entries 表中筛选指定 type，支持单个或多个类型。
   * @param tenantId - 租户 ID
   * @param userId - 用户 ID
   * @param type - 记忆类型或类型数组
   * @param limit - 返回条目上限（默认 20）
   */
  async searchByType(
    tenantId: string,
    userId: string,
    type: string | string[],
    limit: number = 20,
  ): Promise<MemoryEntry[]> {
    const db = getSqlite();
    const types = Array.isArray(type) ? type : [type];
    const placeholders = types.map(() => '?').join(',');
    const rows = db.prepare(
      `SELECT * FROM memory_entries
       WHERE tenant_id = ? AND user_id = ? AND type IN (${placeholders})
       ORDER BY importance DESC, created_at DESC
       LIMIT ?`
    ).all(tenantId, userId, ...types, limit) as any[];
    return rows.map((r) => ({
      ...r,
      embedding: r.embedding ? blobToFloat32(r.embedding) : null,
    }));
  }

  /**
   * 按内容+类型覆盖写入记忆（去重更新）
   * 同 tenant + user + type + 内容前 120 字符匹配时更新，否则插入。
   * 用于 WorkingMemory 的去重存储。
   */
  async upsertByContent(
    entry: Omit<MemoryEntry, 'id' | 'created_at' | 'embedding' | 'expires_at'> & { expires_at?: number | null },
  ): Promise<void> {
    const db = getSqlite();
    const contentKey = entry.content.slice(0, 120);
    const existing = db.prepare(
      `SELECT id FROM memory_entries
       WHERE tenant_id = ? AND user_id = ? AND type = ? AND substr(content, 1, 120) = ?
       LIMIT 1`
    ).get(entry.tenant_id, entry.user_id, entry.type, contentKey) as { id: string } | undefined;

    if (existing) {
      db.prepare(
        `UPDATE memory_entries SET content = ?, importance = ?, expires_at = ? WHERE id = ?`
      ).run(entry.content, entry.importance, entry.expires_at ?? null, existing.id);
    } else {
      const id = uuid();
      db.prepare(
        `INSERT INTO memory_entries (id, tenant_id, user_id, type, content, importance, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(id, entry.tenant_id, entry.user_id, entry.type, entry.content, entry.importance, Date.now(), entry.expires_at ?? null);
    }
  }
}

export const longTermMemory = new LongTermMemory();
