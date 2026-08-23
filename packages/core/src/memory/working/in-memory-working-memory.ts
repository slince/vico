// src/memory/in-memory-working-memory.ts
import type { WorkingMemory } from '../types.js';
import { DEFAULT_WORKING_MEMORY_TEMPLATE } from './default-template.js';

/** 基于 Map 的内存版工作记忆 */
export class InMemoryWorkingMemory implements WorkingMemory {
  private store: Map<string, string> = new Map();
  private template: string;

  constructor(options?: { template?: string }) {
    this.template = options?.template ?? DEFAULT_WORKING_MEMORY_TEMPLATE;
  }

  async get(scopeId: string): Promise<string> {
    return this.store.get(scopeId) ?? '';
  }

  async set(scopeId: string, content: string): Promise<void> {
    this.store.set(scopeId, content);
  }

  getTemplate(): string {
    return this.template;
  }
}
