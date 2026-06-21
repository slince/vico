// src/memory/in-memory-working-memory.ts
import type { WorkingMemory } from './types.js';

/** 基于 Map 的内存版工作记忆 */
export class InMemoryWorkingMemory implements WorkingMemory {
  private store: Map<string, unknown> = new Map();

  async set(key: string, value: unknown): Promise<void> {
    this.store.set(key, value);
  }

  async get(key: string): Promise<unknown | undefined> {
    return this.store.get(key);
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }

  async keys(): Promise<string[]> {
    return Array.from(this.store.keys());
  }

  async clear(): Promise<void> {
    this.store.clear();
  }
}
