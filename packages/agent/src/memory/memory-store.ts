// @vico/agent - MemoryStore: memory processing class wrapping three-layer memory + RAG
import type { ConversationHistoryMemory } from './conversation-history-memory.js';
import type {
  BatchEmbedder,
  SemanticRecallMemory,
  WorkingMemory,
} from './types.js';
import type { RagProvider } from '../rag/types.js';
import { InMemorySemanticRecall } from './semantic/in-memory-semantic-recall.js';
import { InMemoryWorkingMemory } from './working/in-memory-working-memory.js';
import { InMemoryRagProvider } from '../rag/in-memory-rag-provider.js';
import { VectorSemanticRecall } from './semantic/vector-semantic-recall.js';
import { RagVectorStore } from './semantic/rag-vector-store.js';

/** MemoryStore 构造选项 — 各层均可选，未提供时使用内存默认实现 */
export interface MemoryStoreOptions {
  conversation?: ConversationHistoryMemory;
  semantic?: SemanticRecallMemory;
  working?: WorkingMemory;
  rag?: RagProvider;
  /** 批量嵌入器，用于提取文本向量 */
  embedder?: BatchEmbedder;
  /** 是否启用语义召回，默认 true */
  semanticEnabled?: boolean;
  /** 会话历史窗口大小，默认 20 */
  conversationWindow?: number;
}

/** 三层记忆处理类 — 包装 conversation/semantic/working/rag 并提供统一访问入口 */
export class MemoryStore {
  readonly conversation?: ConversationHistoryMemory;
  readonly semantic: SemanticRecallMemory;
  readonly working: WorkingMemory;
  readonly rag: RagProvider;
  /** 批量嵌入器，用于提取文本向量 */
  readonly embedder?: BatchEmbedder;
  /** 语义召回是否启用 */
  readonly semanticEnabled: boolean;
  /** 会话历史窗口大小 */
  readonly conversationWindow: number;

  constructor(options: MemoryStoreOptions = {}) {
    this.semanticEnabled = options.semanticEnabled ?? true;
    this.conversationWindow = options.conversationWindow ?? 20;
    this.conversation = options.conversation;

    if (options.semantic) {
      this.semantic = options.semantic;
    } else if (options.embedder) {
      this.semantic = new VectorSemanticRecall({
        embedder: options.embedder,
        vectorStore: new RagVectorStore(),
      });
    } else {
      this.semantic = new InMemorySemanticRecall();
    }

    this.working = options.working ?? new InMemoryWorkingMemory();

    this.rag = options.rag ?? new InMemoryRagProvider();
    this.embedder = options.embedder;
  }
}
