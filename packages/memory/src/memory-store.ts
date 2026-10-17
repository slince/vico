// @vico/core - MemoryStore: memory processing class wrapping four-layer memory + RAG
import type {ConversationHistoryMemory} from './conversation-history-memory.js';
import type {EpisodicMemory, ProceduralMemory, SemanticMemory} from './types.js';

/** MemoryStore 构造选项 — 各层均可选，未提供时使用内存默认实现 */
export interface MemoryStoreOptions {
  conversation?: ConversationHistoryMemory;
  episodic?: EpisodicMemory;
  semantic?: SemanticMemory;
  procedural?: ProceduralMemory;
}

/** 记忆处理类 — 包装 conversation/episodic/semantic/procedural 并提供统一访问入口 */
export class MemoryStore {
  readonly conversation?: ConversationHistoryMemory;
  readonly episodic?: EpisodicMemory;
  readonly semantic?: SemanticMemory;
  readonly procedural?: ProceduralMemory;

  constructor(options: MemoryStoreOptions = {}) {
    this.conversation = options.conversation;
    this.episodic = options.episodic;
    this.semantic = options.semantic;
    this.procedural = options.procedural;
  }
}
