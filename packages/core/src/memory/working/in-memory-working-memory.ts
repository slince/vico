// src/memory/in-memory-working-memory.ts
import type { WorkingMemory } from '../types.js';

const DEFAULT_TEMPLATE = `# 用户信息
- **姓名**：
- **位置**：
- **时区**：
- **语言**：

## 偏好设置
- **沟通风格**：

## 会话上下文
- **当前任务**：
`;

/** 基于 Map 的内存版工作记忆 */
export class InMemoryWorkingMemory implements WorkingMemory {
  private store: Map<string, string> = new Map();
  private template: string;

  constructor(options?: { template?: string }) {
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
