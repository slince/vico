// @vico/boot - 记忆领域 provider（线程 / 检查点 / 嵌入器 / 向量存储 / 三层记忆）

import { MemoryCheckpointStore } from '@vico/checkpoint';
import { ConversationHistoryMemory, MemoryStore, VectorEpisodicRecall } from '@vico/memory';
import { createEmbedder, type EmbedderConfig } from '@vico/rag';
import { InMemoryThreadStore } from '@vico/thread';
import { InMemoryVectorStore } from '../lib/in-memory-vector-store.js';
import type { VicoServiceProvider } from '../tokens.js';

/**
 * 记忆 provider：注册 `thread` / `checkpointStore` / `embedder` / `vectorStore` / `memory`。
 *
 * 默认装配使用内存实现（thread / checkpoint / vector），使用方可覆盖为持久化适配器；
 * `embedder` 由 `rag.embedder` 配置驱动（"none" 禁用，episodic 记忆随之停用）。
 */
export const memoryProvider: VicoServiceProvider = {
  register(c) {
    c.register('thread', () => new InMemoryThreadStore());
    c.register('checkpointStore', () => new MemoryCheckpointStore());
    c.register('vectorStore', () => new InMemoryVectorStore());
    c.register('embedder', ({ getConfig }) => {
      const configured = getConfig('rag').embedder;
      if (typeof configured === 'string') {
        return configured === 'none' ? undefined : createEmbedder(configured);
      }
      return createEmbedder(configured as unknown as EmbedderConfig);
    });
    c.register('memory', ({ resolve, getConfig }) => {
      const embedder = resolve('embedder');
      return new MemoryStore({
        conversation: new ConversationHistoryMemory(resolve('thread'), getConfig('memory').stm_window),
        episodic: embedder
          ? new VectorEpisodicRecall({ embedder, vectorStore: resolve('vectorStore') })
          : undefined,
      });
    });
  },
};
