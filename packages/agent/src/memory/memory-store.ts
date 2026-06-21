// @vico/agent - MemoryStore: memory processing class wrapping three-layer memory + RAG
import type {ConversationHistoryMemory} from './conversation-history-memory.js';
import type {SemanticRecallMemory, WorkingMemory,} from './types.js';
import {InMemoryWorkingMemory} from './working/in-memory-working-memory.js';

/** MemoryStore 构造选项 — 各层均可选，未提供时使用内存默认实现 */
export interface MemoryStoreOptions {
  conversation?: ConversationHistoryMemory;
  semantic?: SemanticRecallMemory;
  working?: WorkingMemory;
  /** 会话历史窗口大小，默认 20 */
  conversationWindow?: number;
}

/** 三层记忆处理类 — 包装 conversation/semantic/working/rag 并提供统一访问入口 */
export class MemoryStore {
  readonly conversation?: ConversationHistoryMemory;
  readonly semantic?: SemanticRecallMemory;
  readonly working: WorkingMemory;

  /** 会话历史窗口大小 */
  readonly conversationWindow: number;

  constructor(options: MemoryStoreOptions = {}) {
    this.conversationWindow = options.conversationWindow ?? 20;
    this.conversation = options.conversation;

    this.semantic = options.semantic;

    this.working = options.working ?? new InMemoryWorkingMemory();
  }
}
