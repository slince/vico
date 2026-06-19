import { v4 as uuid } from 'uuid';
import { statSync, readdirSync } from 'node:fs';
import { resolve, basename } from 'node:path';
import { MDocument } from '@mastra/rag';
import { config, DEFAULT_RAG_CONFIG } from '../config.js';
import { getVector, getMemory } from '../agent/memory-setup.js';
import logger from '../lib/logger.js';
import { getDb, schema } from '../db/db.js';
import { eq, sql } from 'drizzle-orm';
import { kbIndexName } from '../lib/resource.js';

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
  async indexText(kbId: string, text: string, metadata: Record<string, any> = {}, documentId?: string): Promise<number> {
    const vector = getVector();
    const memory = await getMemory();
    if (!memory.embedder) throw new Error('Embedder not configured');

    // MDocument 分块，策略和大小由 DEFAULT_RAG_CONFIG 控制
    const kbConfig = DEFAULT_RAG_CONFIG;
    const doc = MDocument.fromText(text);
    const chunks = await doc.chunk({
      strategy: kbConfig.chunk.strategy as 'recursive',
      maxSize: kbConfig.chunk.size,
      overlap: kbConfig.chunk.overlap,
    });

    const chunkTexts = chunks.map((c) => c.text);
    const chunkIds = chunks.map(() => uuid());

    // 批量向量化
    const embedResult = await memory.embedder.doEmbed({
      values: chunkTexts,
    });

    const indexName = kbIndexName(kbId);

    // 确保向量索引存在（幂等：已存在则跳过）
    try {
      await vector.createIndex({
        indexName,
        dimension: embedResult.embeddings[0].length,
        metric: 'cosine',
      });
    } catch (err: any) {
      if (!err?.message?.includes('already exists')) throw err;
    }

    // 通过 LibSQLVector 存储，content 写入 metadata 以便检索时还原
    await vector.upsert({
      indexName,
      vectors: embedResult.embeddings,
      ids: chunkIds,
      metadata: chunkTexts.map((c, i) => ({
        content: c,
        chunk_index: i,
        document_id: documentId ?? null,
        ...metadata,
      })),
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

  /** 索引单个文件，通过 ParserRegistry 自动识别类型并提取文本 */
  async indexFile(kbId: string, filePath: string, documentId?: string): Promise<number> {
    // 确保解析器已注册（副作用导入）
    await import('./parsers/registry.js');
    await import('./parsers/txt-parser.js');
    await import('./parsers/md-parser.js');
    await import('./parsers/pdf-parser.js');
    await import('./parsers/csv-parser.js');
    await import('./parsers/html-parser.js');
    await import('./parsers/docx-parser.js');

    const { parserRegistry } = await import('./parsers/registry.js');
    const parser = parserRegistry.findParser(filePath);
    if (!parser) throw new Error(`Unsupported file type: ${filePath}`);

    const result = await parser.parse(filePath);
    return this.indexText(kbId, result.text, {
      filename: basename(filePath),
      source: filePath,
      ...result.metadata,
    }, documentId);
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

  /** 删除指定文档的所有向量 chunks，更新计数 */
  async deleteDocumentChunks(kbId: string, documentId: string): Promise<number> {
    const vector = getVector();
    const indexName = kbIndexName(kbId);

    const { getClient } = await import('../db/init-libsql.js');
    const client = getClient();

    const tableName = indexName;
    const { rows } = await client.execute({
      sql: `SELECT vector_id FROM ${tableName} WHERE json_extract(metadata, '$.document_id') = ?`,
      args: [documentId],
    });

    const ids = rows.map((r: any) => r.vector_id as string);
    if (ids.length === 0) return 0;

    await vector.deleteVectors({ indexName, ids });

    // 更新 KB 计数
    const db = getDb();
    const { knowledge_bases } = schema;
    await db.update(knowledge_bases)
      .set({ chunk_count: sql`MAX(0, ${knowledge_bases.chunk_count} - ${ids.length})` })
      .where(eq(knowledge_bases.id, kbId));

    return ids.length;
  }
}

export const ragManager = new RAGManager();
