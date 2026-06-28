// @vico/agent - MemoryStore: memory processing class wrapping three-layer memory + RAG
import type {ConversationHistoryMemory} from './conversation-history-memory.js';
import type {SemanticRecallMemory, WorkingMemory,} from './types.js';

/** MemoryStore 构造选项 — 各层均可选，未提供时使用内存默认实现 */
export interface MemoryStoreOptions {
  conversation?: ConversationHistoryMemory;
  semantic?: SemanticRecallMemory;
  working?: WorkingMemory;
}

/** 三层记忆处理类 — 包装 conversation/semantic/working/rag 并提供统一访问入口 */
export class MemoryStore {
  readonly conversation?: ConversationHistoryMemory;
  readonly semantic?: SemanticRecallMemory;
  readonly working?: WorkingMemory;

  constructor(options: MemoryStoreOptions = {}) {
    this.conversation = options.conversation;

    this.semantic = options.semantic;

    this.working = options.working;
  }
}
