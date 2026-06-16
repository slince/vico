import { v4 as uuid } from 'uuid';
import { readFileSync, statSync, readdirSync } from 'node:fs';
import { resolve, basename } from 'node:path';
import { MDocument } from '@mastra/rag';
import { config } from '../config.js';
import { getVector, getMemory } from '../agent/memory-setup.js';
import logger from '../lib/logger.js';
import { getDb, schema } from '../db/db.js';
import { eq, sql } from 'drizzle-orm';

class RAGManager {
  /**
   * 索引文本内容到指定知识库。
   *
   * 使用 @mastra/rag MDocument 进行文本分块，
   * 通过 Mastra Memory embedder 向量化后存入 LibSQLVector。
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

    // MDocument 分块，recursive 策略（段落 → 空格 → 字符）
    const doc = MDocument.fromText(text);
    const chunks = await doc.chunk({
      strategy: 'recursive',
      maxSize: config.rag.chunk_size,
      overlap: config.rag.chunk_overlap,
    });

    const chunkTexts = chunks.map((c) => c.text);
    const chunkIds = chunks.map(() => uuid());

    // 批量向量化
    const embedResult = await memory.embedder.doEmbed({
      values: chunkTexts,
    });

    // 通过 LibSQLVector 存储，content 写入 metadata 以便检索时还原
    await vector.upsert({
      indexName: `kb_${kbId}`,
      vectors: embedResult.embeddings,
      ids: chunkIds,
      metadata: chunkTexts.map((c, i) => ({ content: c, chunk_index: i, ...metadata })),
    });

    // 更新知识库分块计数
    const db = getDb();
    const { knowledge_bases } = schema;
    await db
      .update(knowledge_bases)
      .set({ chunk_count: sql`${knowledge_bases.chunk_count} + ${chunkTexts.length}` })
      .where(eq(knowledge_bases.id, kbId));

    return chunkTexts.length;
  }

  /** 索引单个文件，自动识别类型（txt/md/pdf/csv）并提取文本 */
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

  /** 索引目录中所有文件 */
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
}

export const ragManager = new RAGManager();
