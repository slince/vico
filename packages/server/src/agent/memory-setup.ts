/**
 * Mastra Memory + Vector 初始化
 *
 * 提供两个单例 getter：
 * - getVector() — LibSQLVector 单例，连接 libsql 数据库
 * - getMemory() — Mastra Memory 单例，基于 LibSQLVector 和 OpenAI embedder
 */
import { LibSQLVector } from '@mastra/libsql';
import { Memory } from '@mastra/memory';
import { getDatabaseUrl } from '../db/init-libsql.js';

let _vector: LibSQLVector;
let _memory: Memory;

/**
 * Get or create the LibSQLVector singleton for vector search.
 * Uses the same libsql database URL as the main Drizzle connection.
 */
export function getVector(): LibSQLVector {
  if (!_vector) {
    _vector = new LibSQLVector({
      url: getDatabaseUrl(),
      id: 'vico-vector',
    });
  }
  return _vector;
}

/**
 * Get or create the Mastra Memory singleton.
 *
 * Configures:
 * - LibSQL-backed vector store for semantic recall
 * - OpenAI text-embedding-3-small embedder for text embeddings
 * - Last 10 messages for working memory context
 * - Semantic recall enabled with topK=5 and surrounding message context
 */
export function getMemory(): Memory {
  if (!_memory) {
    _memory = new Memory({
      vector: getVector(),
      embedder: 'openai/text-embedding-3-small',
      options: {
        lastMessages: 10,
        semanticRecall: {
          topK: 5,
          messageRange: { before: 2, after: 1 },
        },
      },
    });
  }
  return _memory;
}
