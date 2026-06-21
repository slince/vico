// @vico/agent - MemoryStore: memory processing class wrapping three-layer memory + RAG
import type {
  ConversationHistoryMemory,
  SemanticRecallMemory,
  WorkingMemory,
  RagProvider,
  RagChunk,
} from './types.js';
import type { MemoryRecord } from '../contracts/memory.js';
import { ConversationHistoryMemoryStore } from './conversation-history-memory.js';

/** MemoryStore 构造选项 — 各层均可选，未提供时使用内存默认实现 */
export interface MemoryStoreOptions {
  conversation?: ConversationHistoryMemory;
  semantic?: SemanticRecallMemory;
  working?: WorkingMemory;
  rag?: RagProvider;
  /** 是否启用语义召回，默认 true */
  semanticEnabled?: boolean;
}

/** 三层记忆处理类 — 包装 conversation/semantic/working/rag 并提供统一访问入口 */
export class MemoryStore {
  readonly conversation: ConversationHistoryMemory;
  readonly semantic: SemanticRecallMemory;
  readonly working: WorkingMemory;
  readonly rag: RagProvider;
  /** 语义召回是否启用 */
  readonly semanticEnabled: boolean;

  constructor(options: MemoryStoreOptions = {}) {
    this.semanticEnabled = options.semanticEnabled ?? true;
    this.conversation = options.conversation ?? new ConversationHistoryMemoryStore();

    this.semantic = options.semantic ?? createInMemorySemanticRecall();

    this.working = options.working ?? createInMemoryWorkingMemory();

    this.rag = options.rag ?? createInMemoryRagProvider();
  }
}

/** 创建内存版 SemanticRecallMemory（基于数组的关键词匹配） */
function createInMemorySemanticRecall(): SemanticRecallMemory {
  const records: MemoryRecord[] = [];

  return {
    search: async (query, limit = 5) => {
      const q = query.toLowerCase();
      return records.filter((r) => r.content.toLowerCase().includes(q)).slice(0, limit);
    },
    create: async (record) => { records.push(record); },
    update: async (id, patch) => {
      const idx = records.findIndex((r) => r.id === id);
      if (idx !== -1) Object.assign(records[idx], patch);
    },
    delete: async (id) => {
      const idx = records.findIndex((r) => r.id === id);
      if (idx !== -1) records.splice(idx, 1);
    },
  };
}

/** 创建内存版 WorkingMemory（基于 Map 的实体存储） */
function createInMemoryWorkingMemory(): WorkingMemory {
  const store: Map<string, unknown> = new Map();

  return {
    set: async (key, value) => { store.set(key, value); },
    get: async (key) => store.get(key),
    delete: async (key) => { store.delete(key); },
    keys: async () => Array.from(store.keys()),
    clear: async () => { store.clear(); },
  };
}

/** 创建内存版 RagProvider（基于 Map 的关键词匹配） */
function createInMemoryRagProvider(): RagProvider {
  const chunks: Map<string, RagChunk[]> = new Map();

  return {
    search: async (query, knowledgeBaseId, limit = 5) => {
      const list = chunks.get(knowledgeBaseId) ?? [];
      const q = query.toLowerCase();
      return list.filter((c) => c.content.toLowerCase().includes(q)).slice(0, limit);
    },
  };
}
