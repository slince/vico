/**
 * Mastra Memory + Vector + Storage 初始化
 *
 * 提供三个单例 getter：
 * - getVector() — LibSQLVector 单例，连接 libsql 数据库
 * - getStorage() — LibSQLStore 单例，用于 Memory 的消息持久化与召回
 * - getMemory() — Mastra Memory 单例，基于 LibSQLVector 和 OpenAI embedder
 */
import { LibSQLStore, LibSQLVector } from '@mastra/libsql';
import { Memory } from '@mastra/memory';
import { ModelRouterEmbeddingModel } from '@mastra/core/llm';
import { getDatabaseUrl } from '../db/init-libsql.js';
import { config } from '../config.js';
import logger from '../lib/logger.js';

let _vector: LibSQLVector;
let _storage: LibSQLStore;
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
 * Get or create the LibSQLStore singleton used as Memory's storage backend.
 * Provides persistence for conversation threads, messages, and working memory.
 * Uses the same libsql database URL as the main Drizzle connection.
 */
export function getStorage(): LibSQLStore {
  if (!_storage) {
    _storage = new LibSQLStore({
      url: getDatabaseUrl(),
      id: 'vico-storage',
    });
  }
  return _storage;
}

/**
 * Get or create the Mastra Memory singleton.
 *
 * Configures:
 * - LibSQLStore-backed storage for message persistence and recall
 * - LibSQL-backed vector store for semantic recall
 * - Embedder based on config.rag settings (api mode via ModelRouterEmbeddingModel)
 * - Last 10 messages for working memory context
 * - Semantic recall enabled with topK=5 and surrounding message context
 */
export function getMemory(): Memory {
  if (!_memory) {
    _memory = new Memory({
      storage: getStorage(),
      options: {
        lastMessages: 10,
      },
    });

    // 根据配置注入 embedder
    const { embedder, embedder_model } = config.rag;
    if (embedder === 'api') {
      try {
        _memory.setEmbedder(new ModelRouterEmbeddingModel(embedder_model));
        logger.info({ model: embedder_model }, 'Embedder configured (api)');
      } catch (err) {
        logger.error({ err, model: embedder_model }, 'Failed to create embedder');
      }
    } else {
      logger.warn({ model: embedder_model }, 'Local embedder not yet supported, RAG features will fail');
    }
  }
  return _memory;
}
