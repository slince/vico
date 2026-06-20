// src/memory/memory-store-impl.ts
import type { MemoryStore } from './memory-store.js';
import type { ModelMessage } from '../model/model-client.js';
import type { MemoryRecord } from '../contracts/memory.js';
import type { RagChunk } from './types.js';
import { ShortTermMemory } from './short-term-memory.js';

/** Phase 3 内存版 MemoryStore — STM 完整实现，LTM/RAG 为存根（Phase 5 接 DB） */
export class InMemoryMemoryStore implements MemoryStore {
  stm: {
    push(threadId: string, message: ModelMessage): void;
    get(threadId: string, window: number): ModelMessage[];
  };

  ltm: {
    search(query: string, limit?: number): Promise<MemoryRecord[]>;
    create(record: MemoryRecord): Promise<void>;
    update(id: string, patch: Partial<MemoryRecord>): Promise<void>;
    delete(id: string): Promise<void>;
  };

  rag: {
    search(query: string, knowledgeBaseId: string, limit?: number): Promise<RagChunk[]>;
  };

  constructor() {
    const shortTerm = new ShortTermMemory();
    const ltmRecords: MemoryRecord[] = [];

    this.stm = {
      push: (threadId, message) => shortTerm.push(threadId, message),
      get: (threadId, window) => shortTerm.get(threadId, window),
    };

    this.ltm = {
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
