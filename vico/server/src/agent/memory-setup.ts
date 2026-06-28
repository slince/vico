/**
 * Memory + Vector 初始化（不再依赖 Mastra）。
 *
 * 提供：
 * - getMemory() — MemoryStore 单例
 * - getThreadStore() — DrizzleThreadStore 单例
 * - getVector() — 基于 LibSQLVectorStore 的向量存储
 */
import {ConversationHistoryMemory, MemoryStore} from '@vico/agent';
import {DrizzleThreadStore, LibSQLVectorStore} from '@vico/libsql-adapter';
import {getDb} from '../db/db.js';
import {getClient} from '../db/init-libsql.js';

let _memoryStore: MemoryStore;
let _threadStore: DrizzleThreadStore;
let _vectorStore: LibSQLVectorStore;

export function getMemory(): MemoryStore {
  if (!_memoryStore) {
    _memoryStore = new MemoryStore({
      conversation: new ConversationHistoryMemory(getThreadStore(), 1)
    });
  }
  return _memoryStore;
}

export function getThreadStore(): DrizzleThreadStore {
  if (!_threadStore) {
    _threadStore = new DrizzleThreadStore({ db: getDb() as any });
  }
  return _threadStore;
}

export function getVector(): LibSQLVectorStore {
  if (!_vectorStore) {
    _vectorStore = new LibSQLVectorStore({ client: getClient() });
  }
  return _vectorStore;
}

