/**
 * Memory + Vector + Checkpoint 初始化（不再依赖 Mastra）。
 *
 * 提供：
 * - getMemory() — MemoryStore 单例
 * - getThreadStore() — LibSqlThreadStore 单例
 * - getVector() — 基于 LibSQLVectorStore 的向量存储
 * - getCheckpointStore() — LibSqlCheckpointStore 单例
 */
import {type CheckpointStore, ConversationHistoryMemory, MemoryStore} from '@vico/core';
import {LibSqlCheckpointStore, LibSqlThreadStore, LibSQLVectorStore} from '@vico/libsql-adapter';
import {getDb} from '../db/db.js';
import {getClient} from '../db/init-libsql.js';

let _memoryStore: MemoryStore;
let _threadStore: LibSqlThreadStore;
let _vectorStore: LibSQLVectorStore;
let _checkpointStore: LibSqlCheckpointStore;

export function getMemory(): MemoryStore {
  if (!_memoryStore) {
    _memoryStore = new MemoryStore({
      conversation: new ConversationHistoryMemory(getThreadStore(), 10)
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

