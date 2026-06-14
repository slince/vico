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
 * Configures 4-layer memory architecture:
 * 1. MessageHistory — auto-injected via lastMessages (Mastra built-in)
 * 2. WorkingMemory — Markdown template, scope=resource (user-level)
 * 3. SemanticRecall — vector-based cross-thread recall, topK=5
 * 4. ObservationalMemory — LLM-based conversation observation + reflection
 *
 * All processors are auto-managed by Mastra's memory pipeline:
 * - Pre-request: WorkingMemory + SemanticRecall context auto-injected
 * - Post-request: Messages persisted, OM triggered when threshold crossed
 */
export function getMemory(): Memory {
  if (!_memory) {
    _memory = new Memory({
      storage: getStorage(),
      options: {
        lastMessages: 20,
        workingMemory: {
          enabled: true,
          template: `
# 用户信息
- **称呼**:
- **位置**:
- **职业**:
- **兴趣**:
- **目标**:
- **偏好**:
- **重要事项**:
`,
        },
        semanticRecall: {
          topK: 5,
          messageRange: { before: 2, after: 2 },
        },
        observationalMemory: {
          // Must explicitly specify OM model, default gemini-2.5-flash will fail without Google API key
          model: 'openai/gpt-4o-mini',
          observation: {
            model: 'openai/gpt-4o-mini',
          },
          reflection: {
            model: 'openai/gpt-4o-mini',
          },
        },
      },
    });

    // Inject embedder based on config
    const { embedder, embedder_model } = config.rag;
    if (embedder === 'api') {
      try {
        _memory.setEmbedder(new ModelRouterEmbeddingModel(embedder_model));
        logger.info({ model: embedder_model }, 'Embedder configured (api)');
      } catch (err) {
        logger.error({ err, model: embedder_model }, 'Failed to create embedder');
      }
    } else {
      logger.warn({ model: embedder_model }, 'Local embedder not yet supported');
    }
  }
  return _memory;
}
