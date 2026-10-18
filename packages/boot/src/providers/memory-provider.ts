// @vico/boot - 记忆领域 provider（线程 / 检查点 / 嵌入器 / 向量存储 / 三层记忆）

import { MemoryCheckpointStore } from '@vico/checkpoint';
import { LibSqlCheckpointStore } from '@vico/checkpoint-libsql';
import { MysqlCheckpointStore } from '@vico/checkpoint-mysql';
import { ConversationHistoryMemory, MemoryStore, VectorEpisodicRecall } from '@vico/memory';
import { LibSqlSemanticMemory, type LibSqlSemanticMemoryOptions } from '@vico/memory-libsql';
import { InMemoryVectorStore, createEmbedder, type EmbedderConfig } from '@vico/rag';
import { ChromaVectorStore, type ChromaVectorStoreOptions } from '@vico/rag-chroma';
import { LibSQLVectorStore, type LibSQLVectorStoreOptions } from '@vico/rag-libsql';
import { InMemoryThreadStore } from '@vico/thread';
import { LibSqlThreadStore, type LibSqlThreadStoreOptions } from '@vico/thread-libsql';
import { MysqlThreadStore, type MysqlThreadStoreOptions } from '@vico/thread-mysql';
import { memorySchema, ragSchema, storageSchema } from '../config/schemas/index.js';
import type { VicoServiceProvider, VicoTokens } from '../tokens.js';

/**
 * 记忆 provider：声明 `memory`/`rag`/`storage` 配置段 schema，并注册
 * `thread` / `checkpointStore` / `embedder` / `vectorStore` / `memory` 服务。
 *
 * 存储后端由 `storage` 配置段驱动（memory/libsql/mysql，vector 额外支持 chroma）；
 * 持久化后端所需的连接由使用方注入，其 token 名（service id）取自 `db_service` /
 * `client_service` 配置（默认 `db` / `client`），boot 不自行建立连接。
 * `embedder` 由 `rag.embedder` 配置驱动（"none" 禁用，episodic 记忆随之停用）。
 */
export const memoryProvider: VicoServiceProvider = {
  register(c) {
    c
      .registerConfig('memory', memorySchema)
      .registerConfig('rag', ragSchema)
      .registerConfig('storage', storageSchema);

    c.register('thread', ({ resolve, getConfig }) => {
      const { thread: backend, db_service } = getConfig('storage');
      const dbService = db_service as keyof VicoTokens & string;

      switch (backend) {
        case 'libsql':
          return new LibSqlThreadStore({ db: resolve(dbService) as LibSqlThreadStoreOptions['db'] });

        case 'mysql':
          return new MysqlThreadStore({ db: resolve(dbService) as MysqlThreadStoreOptions['db'] });

        case 'memory':
        default:
          return new InMemoryThreadStore();
      }
    });

    c.register('checkpointStore', ({ resolve, getConfig }) => {
      const { checkpoint: backend, db_service } = getConfig('storage');
      const dbService = db_service as keyof VicoTokens & string;

      switch (backend) {
        case 'libsql':
          return new LibSqlCheckpointStore(
            resolve(dbService) as ConstructorParameters<typeof LibSqlCheckpointStore>[0],
          );

        case 'mysql':
          return new MysqlCheckpointStore(
            resolve(dbService) as ConstructorParameters<typeof MysqlCheckpointStore>[0],
          );

        case 'memory':
        default:
          return new MemoryCheckpointStore();
      }
    });

    c.register('vectorStore', ({ resolve, getConfig }) => {
      const { vector: backend, client_service } = getConfig('storage');
      const clientService = client_service as keyof VicoTokens & string;

      switch (backend) {
        case 'libsql':
          return new LibSQLVectorStore({ client: resolve(clientService) as LibSQLVectorStoreOptions['client'] });

        case 'chroma':
          return new ChromaVectorStore({ client: resolve(clientService) as ChromaVectorStoreOptions['client'] });

        case 'memory':
        default:
          return new InMemoryVectorStore();
      }
    });

    c.register('embedder', ({ getConfig }) => {
      const configured = getConfig('rag').embedder;
      if (typeof configured === 'string') {
        return configured === 'none' ? undefined : createEmbedder(configured);
      }
      return createEmbedder(configured as unknown as EmbedderConfig);
    });

    c.register('memory', ({ resolve, getConfig }) => {
      const memoryConfig = getConfig('memory');
      const dbService = getConfig('storage').db_service as keyof VicoTokens & string;
      const embedder = resolve('embedder');

      return new MemoryStore({
        conversation: new ConversationHistoryMemory(resolve('thread'), memoryConfig.stm_window),
        semantic: memoryConfig.semantic === 'libsql'
          ? new LibSqlSemanticMemory({ db: resolve(dbService) as LibSqlSemanticMemoryOptions['db'] })
          : undefined,
        episodic: embedder
          ? new VectorEpisodicRecall({ embedder, vectorStore: resolve('vectorStore') })
          : undefined,
      });
    });
  },
};
