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
import {createConfiguredEmbedder} from './embedder.js';
import {getDb} from '../db/db.js';
import {getClient} from '../db/init-libsql.js';
import {config} from '../config.js';

let _memoryStore: MemoryStore;
let _threadStore: LibSqlThreadStore;
let _vectorStore: LibSQLVectorStore;
let _checkpointStore: LibSqlCheckpointStore;

export function getMemory(): MemoryStore {
  if (!_memoryStore) {
    const embedder = createConfiguredEmbedder();
    _memoryStore = new MemoryStore({
      conversation: new ConversationHistoryMemory(getThreadStore(), config.memory.stm_window),
      working: new LibSqlWorkingMemory({ db: getDb() as any }),
      // embedder 为 "none" 时禁用语义记忆
      semantic: embedder ? new VectorSemanticRecall({ embedder, vectorStore: getVector() }) : undefined,
    });
  }
  return _memoryStore;
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

