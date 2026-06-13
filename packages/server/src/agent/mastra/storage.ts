// Mastra LibSQL 存储配置，使用独立 DB 文件避免与 Drizzle ORM 冲突

import { LibSQLStore } from '@mastra/libsql';
import { config } from '../../config.js';
import { dirname, join } from 'node:path';

/** Mastra 专用数据库路径，与 vico.db 同目录但独立文件 */
const mastraDbPath = join(dirname(config.database.path), 'vico_mastra.db');

let storage: LibSQLStore;

/** 获取 Mastra LibSQL Storage 单例 */
export function getMastraStorage(): LibSQLStore {
  if (!storage) {
    storage = new LibSQLStore({
      id: 'vico-mastra',
      url: `file:${mastraDbPath}`,
    });
    console.log(`[Mastra] Storage initialized: ${mastraDbPath}`);
  }
  return storage;
}
