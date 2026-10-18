import { v4 as uuid } from 'uuid';
import { statSync, readdirSync } from 'node:fs';
import { resolve, basename } from 'node:path';
import { RecursiveChunker, DefaultParserRegistry } from '@vico/rag';
import type { Embedder, VectorStore } from '@vico/rag';
import { ragSchema } from '@vico/boot';
import type { z } from 'zod';
import type { Client } from '@libsql/client';
import type { Logger } from 'pino';
import { schema } from '../db/db.js';
import type { AppDb } from '../db/db.js';
import { eq, sql } from 'drizzle-orm';
import { kbIndexName } from '../lib/resource.js';

/** RAG 配置切片类型（来自 @vico/boot 的 ragSchema） */
type RagConfig = z.infer<typeof ragSchema>;

const parserRegistry = new DefaultParserRegistry();

export class RAGManager {
  constructor(
    private readonly db: AppDb,
    private readonly client: Client,
    private readonly vectorStore: VectorStore,
    private readonly embedder: Embedder | undefined,
    private readonly ragConfig: RagConfig,
    private readonly logger: Logger,
  ) {}

  /**
   * 索引文本内容到指定知识库。
   *
   * 使用 @vico/rag RecursiveChunker 进行文本分块，
   * 向量化后存入 LibSQL 向量表。
   */
  async indexText(kbId: string, text: string, metadata: Record<string, any> = {}, documentId?: string): Promise<number> {
    const vector = this.vectorStore;
    const kbConfig = this.ragConfig;

    // 使用 @vico/rag RecursiveChunker 分块
    const chunker = new RecursiveChunker();
    const chunks = await chunker.chunk(text, {
      strategy: 'recursive',
      size: kbConfig.chunk_size,
      overlap: kbConfig.chunk_overlap,
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
    const db = this.db;
    const { knowledge_bases } = schema;
    await db
      .update(knowledge_bases)
      .set({ chunk_count: sql`${knowledge_bases.chunk_count} + ${chunkTexts.length}` })
      .where(eq(knowledge_bases.id, kbId));

    return chunkTexts.length;
  }

  /** 获取 embedder 单例（配置为 "none" 时抛错） */
  private getEmbedder(): Embedder {
    const embedder = this.embedder;
    if (!embedder) {
      throw new Error('RAG 索引需要 embedder，请在 server.config.yaml 配置 rag.embedder（当前为 "none"）');
    }
    return embedder;
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
          this.logger.info({ file }, 'RAG indexed');
        } catch (err) {
          this.logger.error({ err, file }, 'RAG index failed');
        }
      }
    }
    return total;
  }

  async deleteDocumentChunks(kbId: string, documentId: string): Promise<number> {
    const vector = this.vectorStore;
    const indexName = kbIndexName(kbId);
    const client = this.client;
    const tableName = indexName;
    const { rows } = await client.execute({
      sql: `SELECT vector_id FROM ${tableName} WHERE json_extract(metadata, '$.document_id') = ?`,
      args: [documentId],
    });
    const ids = rows.map((r: any) => r.vector_id as string);
    if (ids.length === 0) return 0;
    await vector.deleteVectors({ indexName, ids });
    const db = this.db;
    const { knowledge_bases } = schema;
    await db.update(knowledge_bases)
      .set({ chunk_count: sql`MAX(0, ${knowledge_bases.chunk_count} - ${ids.length})` })
      .where(eq(knowledge_bases.id, kbId));
    return ids.length;
  }
}
