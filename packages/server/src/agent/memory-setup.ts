/**
 * Mastra Memory + Vector + Storage 初始化
 *
 * 提供三个单例 getter：
 * - getVector() — LibSQLVector 单例，连接 libsql 数据库
 * - getStorage() — MastraCompositeStore 单例，LibSQLStore 作为默认存储后端
 * - getMemory() — Mastra Memory 单例，基于 LibSQLVector 和 OpenAI embedder
 */
import {LibSQLStore, LibSQLVector} from '@mastra/libsql';
import {DuckDBStore} from '@mastra/duckdb';
import {MastraCompositeStore} from '@mastra/core/storage';
import {Memory} from '@mastra/memory';
import {ModelRouterEmbeddingModel} from '@mastra/core/llm';
import {getDatabaseUrl} from '../db/init-libsql.js';
import {config} from '../config.js';
import logger from '../lib/logger.js';

let _vector: LibSQLVector;
let _storage: MastraCompositeStore;
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
 * Get or create the MastraCompositeStore singleton.
 *
 * 使用 MastraCompositeStore 包装 LibSQLStore 作为默认存储后端。
 * 支持按 domain 将不同领域的数据路由到不同存储适配器，
 * 与 Mastra 框架推荐的存储组合模式保持一致。
 *
 * LibSQLStore 负责所有域的持久化：对话线程、消息、工作记忆、工作流状态等。
 */
export async function getStorage(): Promise<MastraCompositeStore> {
  if (!_storage) {
    _storage = new MastraCompositeStore({
      id: 'vico-composite-storage',
      default: new LibSQLStore({
        id: 'vico-storage',
        url: getDatabaseUrl(),
      }),
      domains: {
        observability: await new DuckDBStore({ path: config.database.duckdb_url }).getStore('observability'),
      },
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
export async function getMemory(): Promise<Memory> {
  if (!_memory) {
    _memory = new Memory({
      storage: await getStorage(),
      vector: getVector(),
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
          // semanticRecall: {
          //     topK: 5,
          //     messageRange: { before: 2, after: 2 },
          // },
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
