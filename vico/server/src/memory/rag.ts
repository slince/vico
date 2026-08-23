import { v4 as uuid } from 'uuid';
import { statSync, readdirSync } from 'node:fs';
import { resolve, basename } from 'node:path';
import { RecursiveChunker, createEmbedder, DefaultParserRegistry } from '@vico/rag';
import type { Embedder } from '@vico/rag';
import { config, DEFAULT_RAG_CONFIG } from '../config.js';
import { getVector } from '../agent/memory-setup.js';
import logger from '../lib/logger.js';
import { getDb, schema } from '../db/db.js';
import { eq, sql } from 'drizzle-orm';
import { kbIndexName } from '../lib/resource.js';
import { getClient } from '../db/init-libsql.js';

const parserRegistry = new DefaultParserRegistry();

let _embedder: Embedder | undefined;

/**
 * 从 server.config.yaml 的 rag.embedder 配置构建 Embedder。
 * RAG 索引与语义记忆共用此单例，避免重复创建 embedder 实例。
 *
 * @returns Embedder 实例，配置无法解析时抛出
 */
export function createConfiguredEmbedder(): Embedder {
  if (_embedder) return _embedder;
  const embedder = createEmbedder(config.rag.embedder);
  _embedder = embedder;
  return embedder;
}

class RAGManager {
  /**
   * 索引文本内容到指定知识库。
   *
   * 使用 @vico/rag RecursiveChunker 进行文本分块，
   * 向量化后存入 LibSQL 向量表。
   */
  async indexText(kbId: string, text: string, metadata: Record<string, any> = {}, documentId?: string): Promise<number> {
    const vector = getVector();
    const kbConfig = DEFAULT_RAG_CONFIG;

    // 使用 @vico/rag RecursiveChunker 分块
    const chunker = new RecursiveChunker();
    const chunks = await chunker.chunk(text, {
      strategy: 'recursive',
      size: kbConfig.chunk.size,
      overlap: kbConfig.chunk.overlap,
    });
    const chunkTexts = chunks.map((c) => c.text);
    const chunkIds = chunks.map(() => uuid());

    // 向量化（需要 embedder — 由调用方提供或使用默认）
    const embedder = this.getEmbedder();
    const embedResult = await embedder.doEmbed({ values: chunkTexts });

    const indexName = kbIndexName(kbId);

    // 确保向量索引存在
    try {
      await vector.createIndex({
        indexName,
        dimension: embedResult.embeddings[0].length,
        metric: 'cosine',
      });
    } catch (err: any) {
      if (!err?.message?.includes('already exists')) throw err;
    }

    // 存储向量
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

  /** 获取 embedder 单例 */
  private getEmbedder(): Embedder {
    return createConfiguredEmbedder();
  }

  async indexFile(kbId: string, filePath: string, documentId?: string): Promise<number> {
    const parser = parserRegistry.findParser(filePath);
    if (!parser) throw new Error(`Unsupported file type: ${filePath}`);
    const result = await parser.parse(filePath);
    return this.indexText(kbId, result.text, {
      filename: basename(filePath),
      source: filePath,
      ...result.metadata,
    }, documentId);
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

  async deleteDocumentChunks(kbId: string, documentId: string): Promise<number> {
    const vector = getVector();
    const indexName = kbIndexName(kbId);
    const client = getClient();
    const tableName = indexName;
    const { rows } = await client.execute({
      sql: `SELECT vector_id FROM ${tableName} WHERE json_extract(metadata, '$.document_id') = ?`,
      args: [documentId],
    });
    const ids = rows.map((r: any) => r.vector_id as string);
    if (ids.length === 0) return 0;
    await vector.deleteVectors({ indexName, ids });
    const db = getDb();
    const { knowledge_bases } = schema;
    await db.update(knowledge_bases)
      .set({ chunk_count: sql`MAX(0, ${knowledge_bases.chunk_count} - ${ids.length})` })
      .where(eq(knowledge_bases.id, kbId));
    return ids.length;
  }
}

export const ragManager = new RAGManager();
