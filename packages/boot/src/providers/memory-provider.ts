// @vico/boot - 记忆领域 provider（绑定存储三件套 + 嵌入器 + 三层记忆）

import type { VicoServiceProvider } from '../tokens.js';

/**
 * 记忆 provider：绑定 `thread` / `checkpointStore` / `embedder` / `vectorStore` / `memory`。
 *
 * 依赖拓扑：thread/checkpointStore/vectorStore → embedder → memory。
 * `thread` / `checkpointStore` / `vectorStore` 的持久化实现（libsql/mysql/chroma）由
 * 使用方注入 adapter；boot 提供内存默认实现或标注 TODO。
 */
export const memoryProvider: VicoServiceProvider = {
  register(c) {
    // TODO(迁移): c.register('thread', () => new InMemoryThreadStore());
    // TODO(迁移): c.register('checkpointStore', () => new MemoryCheckpointStore());
    // TODO(迁移): c.register('embedder', ({ getConfig }) => createEmbedder(getConfig('rag').embedder));
    // TODO(迁移): c.register('vectorStore', ({ resolve }) => /* 使用方注入的向量存储 */);
    // TODO(迁移): c.register('memory', ({ resolve, getConfig }) => new MemoryStore({
    //   conversation: new ConversationHistoryMemory(resolve('thread'), getConfig('memory').stm_window),
    //   semantic: new FileSemanticMemory({ ... }),
    //   episodic: resolve('embedder') ? new VectorEpisodicRecall({ embedder, vectorStore: resolve('vectorStore') }) : undefined,
    // }));
  },
};
