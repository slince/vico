// @vico/agent - MemoryStore: memory processing class wrapping three-layer memory + RAG
import type { ConversationHistoryMemory } from './conversation-history-memory.js';
import type {
  SemanticRecallMemory,
  WorkingMemory,
  RagProvider,
} from './types.js';
import { InMemorySemanticRecall } from './in-memory-semantic-recall.js';
import { InMemoryWorkingMemory } from './in-memory-working-memory.js';
import { InMemoryRagProvider } from './in-memory-rag-provider.js';

/** MemoryStore 构造选项 — 各层均可选，未提供时使用内存默认实现 */
export interface MemoryStoreOptions {
  conversation?: ConversationHistoryMemory;
  semantic?: SemanticRecallMemory;
  working?: WorkingMemory;
  rag?: RagProvider;
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
  /** 语义召回是否启用 */
  readonly semanticEnabled: boolean;
  /** 会话历史窗口大小 */
  readonly conversationWindow: number;

  constructor(options: MemoryStoreOptions = {}) {
    this.semanticEnabled = options.semanticEnabled ?? true;
    this.conversationWindow = options.conversationWindow ?? 20;
    this.conversation = options.conversation;

    this.semantic = options.semantic ?? new InMemorySemanticRecall();

    this.working = options.working ?? new InMemoryWorkingMemory();

    this.rag = options.rag ?? new InMemoryRagProvider();
  }
}
