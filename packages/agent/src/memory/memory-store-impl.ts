// src/memory/memory-store-impl.ts
import type { MemoryStore } from './memory-store.js';
import type { ModelMessage } from '../model/model-client.js';
import type { MemoryRecord } from '../contracts/memory.js';
import type { RagChunk } from './types.js';
import { ConversationHistoryMemoryStore } from './conversation-history-memory.js';

/** Phase 3 内存版 MemoryStore — conversation 完整实现，semantic/working/rag 为存根（Phase 5 接 DB） */
export class InMemoryMemoryStore implements MemoryStore {
  conversation: ConversationHistoryMemoryStore;

  semantic: {
    search(query: string, limit?: number): Promise<MemoryRecord[]>;
    create(record: MemoryRecord): Promise<void>;
    update(id: string, patch: Partial<MemoryRecord>): Promise<void>;
    delete(id: string): Promise<void>;
  };

  working: {
    set(key: string, value: unknown): Promise<void>;
    get(key: string): Promise<unknown | undefined>;
    delete(key: string): Promise<void>;
    keys(): Promise<string[]>;
    clear(): Promise<void>;
  };

  rag: {
    search(query: string, knowledgeBaseId: string, limit?: number): Promise<RagChunk[]>;
  };

  constructor() {
    const conversation = new ConversationHistoryMemoryStore();
    this.conversation = conversation;

    const ltmRecords: MemoryRecord[] = [];

    this.semantic = {
      search: async (query, limit = 5) => {
        const q = query.toLowerCase();
        const filtered = ltmRecords
          .filter((r) => r.content.toLowerCase().includes(q))
          .slice(0, limit);
        return filtered;
      },
      create: async (record) => { ltmRecords.push(record); },
      update: async (id, patch) => {
        const idx = ltmRecords.findIndex((r) => r.id === id);
        if (idx !== -1) Object.assign(ltmRecords[idx], patch);
      },
      delete: async (id) => {
        const idx = ltmRecords.findIndex((r) => r.id === id);
        if (idx !== -1) ltmRecords.splice(idx, 1);
      },
    };

    const workingStore: Map<string, unknown> = new Map();

    this.working = {
      set: async (key, value) => { workingStore.set(key, value); },
      get: async (key) => workingStore.get(key),
      delete: async (key) => { workingStore.delete(key); },
      keys: async () => Array.from(workingStore.keys()),
      clear: async () => { workingStore.clear(); },
    };

    const ragChunks: Map<string, RagChunk[]> = new Map();

    this.rag = {
      search: async (query, knowledgeBaseId, limit = 5) => {
        const chunks = ragChunks.get(knowledgeBaseId) ?? [];
        const q = query.toLowerCase();
        return chunks.filter((c) => c.content.toLowerCase().includes(q)).slice(0, limit);
      },
    };
  }
}
