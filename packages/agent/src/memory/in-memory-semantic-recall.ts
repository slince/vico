// src/memory/in-memory-semantic-recall.ts
import type { SemanticRecallMemory } from './types.js';
import type { MemoryRecord } from './types.js';

/** 基于数组关键词匹配的内存版语义召回 */
export class InMemorySemanticRecall implements SemanticRecallMemory {
  private records: MemoryRecord[] = [];

  async search(query: string, limit = 5): Promise<MemoryRecord[]> {
    const q = query.toLowerCase();
    return this.records.filter((r) => r.content.toLowerCase().includes(q)).slice(0, limit);
  }

  async create(record: MemoryRecord): Promise<void> {
    this.records.push(record);
  }

  async update(id: string, patch: Partial<MemoryRecord>): Promise<void> {
    const idx = this.records.findIndex((r) => r.id === id);
    if (idx !== -1) Object.assign(this.records[idx], patch);
  }

  async delete(id: string): Promise<void> {
    const idx = this.records.findIndex((r) => r.id === id);
    if (idx !== -1) this.records.splice(idx, 1);
  }
}
