// @vico/boot - 记忆领域 provider（线程 / 检查点 / 嵌入器 / 向量存储 / 三层记忆）

import { CheckpointPurge, MemoryCheckpointStore } from '@vico/checkpoint';
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
import { checkpointSchema, memorySchema, ragSchema, storageSchema } from '../config/schemas/index.js';
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
      .registerConfig('storage', storageSchema)
      .registerConfig('checkpoint', checkpointSchema);

    c.register('thread', ({ get, getConfig }) => {
      const { thread: backend, db_service } = getConfig('storage');
      const dbService = db_service as keyof VicoTokens & string;

      switch (backend) {
        case 'libsql':
          return new LibSqlThreadStore({ db: get(dbService) as LibSqlThreadStoreOptions['db'] });

        case 'mysql':
          return new MysqlThreadStore({ db: get(dbService) as MysqlThreadStoreOptions['db'] });

        case 'memory':
        default:
          return new InMemoryThreadStore();
      }
    });

    c.register('checkpointStore', ({ get, getConfig }) => {
      const { checkpoint: backend, db_service } = getConfig('storage');
      const dbService = db_service as keyof VicoTokens & string;

      switch (backend) {
        case 'libsql':
          return new LibSqlCheckpointStore(
            get(dbService) as ConstructorParameters<typeof LibSqlCheckpointStore>[0],
          );

        case 'mysql':
          return new MysqlCheckpointStore(
            get(dbService) as ConstructorParameters<typeof MysqlCheckpointStore>[0],
          );

        case 'memory':
        default:
          return new MemoryCheckpointStore();
      }
    });

    c.register('checkpointPurge', ({ get, getConfig }) =>
      new CheckpointPurge(
        get('checkpointStore'),
        getConfig('checkpoint').ttl_days * 24 * 60 * 60 * 1000,
        get('logger'),
      ));

    c.register('vectorStore', ({ get, getConfig }) => {
      const { vector: backend, client_service } = getConfig('storage');
      const clientService = client_service as keyof VicoTokens & string;

      switch (backend) {
        case 'libsql':
          return new LibSQLVectorStore({ client: get(clientService) as LibSQLVectorStoreOptions['client'] });

        case 'chroma':
          return new ChromaVectorStore({ client: get(clientService) as ChromaVectorStoreOptions['client'] });

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

    c.register('memory', ({ get, getConfig }) => {
      const memoryConfig = getConfig('memory');
      const dbService = getConfig('storage').db_service as keyof VicoTokens & string;
      const embedder = get('embedder');

      return new MemoryStore({
        conversation: new ConversationHistoryMemory(get('thread'), memoryConfig.stm_window),
        semantic: memoryConfig.semantic === 'libsql'
          ? new LibSqlSemanticMemory({ db: get(dbService) as LibSqlSemanticMemoryOptions['db'] })
          : undefined,
        episodic: embedder
          ? new VectorEpisodicRecall({ embedder, vectorStore: get('vectorStore') })
          : undefined,
      });
    });
  },
};
