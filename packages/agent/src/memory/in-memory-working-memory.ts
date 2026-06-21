// src/memory/in-memory-working-memory.ts
import type { WorkingMemory } from './types.js';

const DEFAULT_TEMPLATE = `# User Facts
- **Name**:
- **Location**:
- **Time Zone**:
- **Language**:

## Preferences
- **Communication Style**:

## Session Context
- **Current Task**:
`;

/** 基于 Map 的内存版工作记忆 */
export class InMemoryWorkingMemory implements WorkingMemory {
  readonly scope: 'user' | 'workspace';
  private store: Map<string, string> = new Map();
  private template: string;

  constructor(options?: { scope?: 'user' | 'workspace'; template?: string }) {
    this.scope = options?.scope ?? 'user';
    this.template = options?.template ?? DEFAULT_TEMPLATE;
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
