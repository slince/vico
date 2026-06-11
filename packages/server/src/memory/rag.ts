import { v4 as uuid } from 'uuid';
import { readFileSync, statSync, existsSync, readdirSync } from 'node:fs';
import { resolve, basename } from 'node:path';
import { getSqlite } from '../db/db.js';
import { getEmbedder, float32ToBlob, blobToFloat32, cosineSimilarity } from './embedder.js';
import { config } from '../config.js';

export interface RetrievedChunk {
  id: string;
  content: string;
  score: number;
  metadata: Record<string, any>;
}

class RAGManager {
  async indexText(kbId: string, text: string, metadata: Record<string, any> = {}): Promise<number> {
    const db = getSqlite();
    const embedder = await getEmbedder();
    const chunks = this.splitText(text);
    const embeddings = await embedder.embedBatch(chunks);
    const now = Date.now();
    let count = 0;

    const insert = db.prepare('INSERT INTO chunks (id, kb_id, content, embedding, metadata, created_at) VALUES (?, ?, ?, ?, ?, ?)');

    const tx = db.transaction(() => {
      for (let i = 0; i < chunks.length; i++) {
        insert.run(uuid(), kbId, chunks[i], float32ToBlob(embeddings[i]), JSON.stringify({ ...metadata, chunk_index: i }), now);
        count++;
      }
    });

    tx();

    db.prepare('UPDATE knowledge_bases SET chunk_count = chunk_count + ? WHERE id = ?').run(count, kbId);
    return count;
  }

  async indexFile(kbId: string, filePath: string): Promise<number> {
    let text: string;
    const ext = basename(filePath).toLowerCase();

    if (ext.endsWith('.md') || ext.endsWith('.txt')) {
      text = readFileSync(filePath, 'utf-8');
    } else if (ext.endsWith('.pdf')) {
      try {
        const pdfParse = (await import('pdf-parse')).default;
        const buf = readFileSync(filePath);
        const data = await pdfParse(buf);
        text = data.text;
      } catch (err) {
        throw new Error(`PDF parsing failed: ${err}`);
      }
    } else if (ext.endsWith('.csv')) {
      text = readFileSync(filePath, 'utf-8');
    } else {
      throw new Error(`Unsupported file type: ${ext}`);
    }

    return this.indexText(kbId, text, { filename: basename(filePath), source: filePath });
  }

  async indexResourceDir(kbId: string, resourceDir: string): Promise<number> {
    let total = 0;
    const files = readdirSync(resourceDir);
    for (const file of files) {
      const fullPath = resolve(resourceDir, file);
      if (statSync(fullPath).isFile()) {
        try {
          total += await this.indexFile(kbId, fullPath);
          console.log(`[RAG] Indexed: ${file}`);
        } catch (err) {
          console.error(`[RAG] Failed to index ${file}:`, err);
        }
      }
    }
    return total;
  }

  async semanticSearch(query: string, kbIds: string[], topK: number): Promise<RetrievedChunk[]> {
    const db = getSqlite();
    const embedder = await getEmbedder();
    const queryEmb = await embedder.embed(query);

    const placeholders = kbIds.map(() => '?').join(',');
    const rows = db.prepare(`SELECT * FROM chunks WHERE kb_id IN (${placeholders}) ORDER BY created_at DESC LIMIT 2000`).all(...kbIds) as any[];

    return rows
      .filter((r) => r.embedding)
      .map((r) => ({
        id: r.id,
        content: r.content,
        score: cosineSimilarity(queryEmb, blobToFloat32(r.embedding)),
        metadata: JSON.parse(r.metadata || '{}'),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
  }

  async keywordSearch(query: string, kbIds: string[], topK: number): Promise<RetrievedChunk[]> {
    const db = getSqlite();
    const keywords = query.toLowerCase().split(/\s+/).filter((k) => k.length > 1);
    if (keywords.length === 0) return [];

    const placeholders = kbIds.map(() => '?').join(',');
    const rows = db.prepare(`SELECT * FROM chunks WHERE kb_id IN (${placeholders})`).all(...kbIds) as any[];

    return rows
      .filter((r) => {
        const content = r.content.toLowerCase();
        return keywords.some((kw) => content.includes(kw));
      })
      .map((r) => ({
        id: r.id,
        content: r.content,
        score: keywords.filter((kw) => r.content.toLowerCase().includes(kw)).length / keywords.length,
        metadata: JSON.parse(r.metadata || '{}'),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
  }

  async hybridSearch(query: string, kbIds: string[], topK: number): Promise<RetrievedChunk[]> {
    const [semanticResults, keywordResults] = await Promise.all([
      this.semanticSearch(query, kbIds, topK * 2),
      this.keywordSearch(query, kbIds, topK * 2),
    ]);

    const merged = new Map<string, { chunk: RetrievedChunk; semanticScore: number; keywordScore: number }>();

    for (const c of semanticResults) {
      merged.set(c.id, { chunk: c, semanticScore: c.score, keywordScore: 0 });
    }
    for (const c of keywordResults) {
      if (merged.has(c.id)) {
        merged.get(c.id)!.keywordScore = c.score;
      } else {
        merged.set(c.id, { chunk: c, semanticScore: 0, keywordScore: c.score });
      }
    }

    const results = Array.from(merged.values())
      .map((m) => ({
        ...m.chunk,
        score: m.semanticScore * 0.7 + m.keywordScore * 0.3,
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);

    return results;
  }

  private splitText(text: string): string[] {
    const { chunk_size, chunk_overlap } = config.rag;
    const chunks: string[] = [];
    const cleaned = text.replace(/\s+/g, ' ').trim();
    const paragraphs = cleaned.split(/\n\s*\n/);
    let current = '';

    for (const para of paragraphs) {
      if ((current.length + para.length) > chunk_size && current.length > 0) {
        chunks.push(current.trim());
        current = '';
      }
      if (para.length > chunk_size) {
        const words = para.split(/\s+/);
        let i = 0;
        while (i < words.length) {
          const slice = words.slice(i, i + chunk_size);
          chunks.push(slice.join(' '));
          i += chunk_size - chunk_overlap;
        }
      } else {
        current += (current ? ' ' : '') + para;
      }
    }
    if (current.trim()) chunks.push(current.trim());
    return chunks.length > 0 ? chunks : [cleaned.slice(0, 2000)];
  }
}

export const ragManager = new RAGManager();
