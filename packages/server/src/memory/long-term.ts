import { getDb } from '../data/db.js';
import { getEmbedder, float32ToBlob, blobToFloat32, cosineSimilarity } from './embedder.js';
import { config } from '../config.js';
import { v4 as uuid } from 'uuid';

export interface MemoryEntry {
  id: string;
  tenant_id: string;
  user_id: string;
  type: 'fact' | 'preference' | 'summary' | 'decision';
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
    const db = getDb();
    const embedder = await getEmbedder();
    const embedding = await embedder.embed(content);

    db.prepare(`INSERT INTO memory_entries (id, tenant_id, user_id, type, content, embedding, importance, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
      uuid(), tenantId, userId, type, content, float32ToBlob(embedding), importance, Date.now()
    );
  }

  async retrieve(tenantId: string, userId: string, query: string, topK = 5): Promise<MemoryEntry[]> {
    const db = getDb();
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
    const db = getDb();
    const count = (db.prepare('SELECT COUNT(*) as c FROM memory_entries WHERE tenant_id = ? AND user_id = ?').get(tenantId, userId) as any)?.c || 0;
    if (count > config.memory.ltm_max_entries) {
      db.prepare('DELETE FROM memory_entries WHERE id IN (SELECT id FROM memory_entries WHERE tenant_id = ? AND user_id = ? ORDER BY created_at ASC LIMIT ?)').run(
        tenantId, userId, Math.floor(config.memory.ltm_max_entries * 0.1)
      );
    }
  }
}

export const longTermMemory = new LongTermMemory();
