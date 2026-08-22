/**
 * Memory + Vector + Checkpoint 初始化（不再依赖 Mastra）。
 *
 * 提供：
 * - getMemory() — MemoryStore 单例
 * - getThreadStore() — LibSqlThreadStore 单例
 * - getVector() — 基于 LibSQLVectorStore 的向量存储
 * - getCheckpointStore() — LibSqlCheckpointStore 单例
 */
import {type CheckpointStore, ConversationHistoryMemory, MemoryStore, VectorSemanticRecall} from '@vico/core';
import {LibSqlCheckpointStore, LibSqlThreadStore, LibSQLVectorStore, LibSqlWorkingMemory} from '@vico/libsql-adapter';
import type {BatchEmbedder} from '@vico/rag';
import {createConfiguredEmbedder} from '../memory/rag.js';
import {getDb} from '../db/db.js';
import {getClient} from '../db/init-libsql.js';

let _memoryStore: MemoryStore;
let _threadStore: LibSqlThreadStore;
let _vectorStore: LibSQLVectorStore;
let _checkpointStore: LibSqlCheckpointStore;

export function getMemory(): MemoryStore {
  if (!_memoryStore) {
    _memoryStore = new MemoryStore({
      conversation: new ConversationHistoryMemory(getThreadStore(), 10),
      working: new LibSqlWorkingMemory({ db: getDb() as any }),
      semantic: new VectorSemanticRecall({
        embedder: createLazyEmbedder(),
        vectorStore: getVector(),
      }),
    });
  }
  return _memoryStore;
}

/** 懒加载 embedder — createEmbedder 动态 import 依赖，延迟到首次嵌入时创建 */
function createLazyEmbedder(): BatchEmbedder {
  let cache: BatchEmbedder | undefined;
  let loading: Promise<BatchEmbedder | undefined> | undefined;
  return {
    async doEmbed(options) {
      if (!cache) {
        loading ??= createConfiguredEmbedder();
        const embedder = await loading;
        if (!embedder) {
          throw new Error('Failed to initialize embedder (check server.config.yaml rag.embedder)');
        }
        cache = embedder;
      }
      return cache.doEmbed(options);
    },
  };
}

export function getThreadStore(): LibSqlThreadStore {
  if (!_threadStore) {
    _threadStore = new LibSqlThreadStore({ db: getDb() as any });
  }
  return _threadStore;
}

export function getVector(): LibSQLVectorStore {
  if (!_vectorStore) {
    _vectorStore = new LibSQLVectorStore({ client: getClient() });
  }
  return _vectorStore;
}

export function getCheckpointStore(): CheckpointStore {
  if (!_checkpointStore) {
    _checkpointStore = new LibSqlCheckpointStore(getDb() as any);
  }
  return _checkpointStore;
}

