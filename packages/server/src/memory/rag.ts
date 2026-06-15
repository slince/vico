import { v4 as uuid } from 'uuid';
import { readFileSync, statSync, existsSync, readdirSync } from 'node:fs';
import { resolve, basename } from 'node:path';
import { config } from '../config.js';
import { getVector, getMemory } from '../agent/memory-setup.js';
import logger from '../lib/logger.js';
import { getDb, schema } from '../db/db.js';
import { eq, sql } from 'drizzle-orm';

export interface RetrievedChunk {
  id: string;
  content: string;
  score: number;
  metadata: Record<string, any>;
}

class RAGManager {
  /**
   * 索引文本内容到指定知识库。
   *
   * 使用 Mastra Memory embedder 将文本分块向量化，
   * 通过 LibSQLVector.upsert() 存储向量及元数据。
   *
   * @param kbId - 知识库 ID
   * @param text - 待索引的原始文本
   * @param metadata - 附加元数据
   * @returns 索引的分块数量
   */
  async indexText(kbId: string, text: string, metadata: Record<string, any> = {}): Promise<number> {
    const vector = getVector();
    const memory = await getMemory();
    if (!memory.embedder) throw new Error('Embedder not configured');

    const chunks = this.splitText(text);
    const chunkIds = chunks.map(() => uuid());

    // 批量向量化
    const embedResult = await memory.embedder.doEmbed({
      values: chunks.map((c) => c),
    });

    // 通过 LibSQLVector 存储，content 写入 metadata 以便检索时还原
    await vector.upsert({
      indexName: `kb_${kbId}`,
      vectors: embedResult.embeddings,
      ids: chunkIds,
      metadata: chunks.map((c, i) => ({ content: c, chunk_index: i, ...metadata })),
    });

    // 更新知识库分块计数
    const db = getDb();
    const { knowledge_bases } = schema;
    await db
      .update(knowledge_bases)
      .set({ chunk_count: sql`${knowledge_bases.chunk_count} + ${chunks.length}` })
      .where(eq(knowledge_bases.id, kbId));

    return chunks.length;
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
          logger.info({ file }, 'RAG indexed');
        } catch (err) {
          logger.error({ err, file }, 'RAG index failed');
        }
      }
    }
    return total;
  }

  /**
   * 语义搜索：使用 LibSQLVector 进行向量相似度检索。
   *
   * 将查询文本向量化后在指定知识库索引中搜索 topK 条最相似结果。
   *
   * @param query - 搜索查询文本
   * @param kbIds - 知识库 ID 列表
   * @param topK - 返回结果数量
   * @returns 按相似度降序排列的检索结果
   */
  async semanticSearch(query: string, kbIds: string[], topK: number): Promise<RetrievedChunk[]> {
    const vector = getVector();
    const memory = await getMemory();
    if (!memory.embedder) throw new Error('Embedder not configured');

    const embedResult = await memory.embedder.doEmbed({ values: [query] });
    const queryEmbedding = embedResult.embeddings[0];

    const allResults: RetrievedChunk[] = [];

    for (const kbId of kbIds) {
      const indexName = `kb_${kbId}`;
      try {
        const results = await vector.query({
          indexName,
          queryVector: queryEmbedding,
          topK,
        });
        for (const r of results) {
          allResults.push({
            id: r.id,
            content: (r.metadata?.content as string) || '',
            score: r.score,
            metadata: (r.metadata || {}) as Record<string, any>,
          });
        }
      } catch {
        // 索引可能尚未创建，静默跳过
        continue;
      }
    }

    return allResults.sort((a, b) => b.score - a.score).slice(0, topK);
  }

  /**
   * 关键词搜索：基于内容文本的关键词匹配。
   *
   * 通过向量近似检索获取候选集，再按关键词匹配过滤和打分。
   *
   * @param query - 搜索查询文本
   * @param kbIds - 知识库 ID 列表
   * @param topK - 返回结果数量
   * @returns 按关键词匹配度降序排列的检索结果
   */
  async keywordSearch(query: string, kbIds: string[], topK: number): Promise<RetrievedChunk[]> {
    const keywords = query.toLowerCase().split(/\s+/).filter((k) => k.length > 1);
    if (keywords.length === 0) return [];

    const vector = getVector();
    const memory = await getMemory();
    if (!memory.embedder) throw new Error('Embedder not configured');

    // 使用查询向量获取更大候选集，再按关键词过滤
    const embedResult = await memory.embedder.doEmbed({ values: [query] });
    const queryEmbedding = embedResult.embeddings[0];

    const candidates: { id: string; content: string; metadata: Record<string, any> }[] = [];

    for (const kbId of kbIds) {
      const indexName = `kb_${kbId}`;
      try {
        const results = await vector.query({
          indexName,
          queryVector: queryEmbedding,
          topK: topK * 3,
        });
        for (const r of results) {
          const content = (r.metadata?.content as string) || '';
          if (content) {
            candidates.push({
              id: r.id,
              content,
              metadata: (r.metadata || {}) as Record<string, any>,
            });
          }
        }
      } catch {
        continue;
      }
    }

    return candidates
      .filter((c) => {
        const lowerContent = c.content.toLowerCase();
        return keywords.some((kw) => lowerContent.includes(kw));
      })
      .map((c) => ({
        id: c.id,
        content: c.content,
        score: keywords.filter((kw) => c.content.toLowerCase().includes(kw)).length / keywords.length,
        metadata: c.metadata,
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
