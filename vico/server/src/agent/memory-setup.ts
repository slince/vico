/**
 * Memory + Vector 初始化（不再依赖 Mastra）。
 *
 * 提供：
 * - getVector() — 基于 LibSQLVectorStore 的向量存储
 */
import { LibSQLVectorStore } from '@vico/libsql-adapter';
import { getClient } from '../db/init-libsql.js';

let _vectorStore: LibSQLVectorStore;

export function getVector(): LibSQLVectorStore {
  if (!_vectorStore) {
    _vectorStore = new LibSQLVectorStore({ client: getClient() });
  }
  return _vectorStore;
}
