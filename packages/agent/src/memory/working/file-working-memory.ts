// src/memory/file-working-memory.ts
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { WorkingMemory } from '../types.js';

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

/** 构造选项 */
export interface FileWorkingMemoryOptions {
  /** 文件存储目录 */
  dir: string;
  /** 作用域，默认 'user' */
  scope?: 'user' | 'workspace';
  /** Markdown 模板，未提供时使用默认模板 */
  template?: string;
}

/** 基于 Markdown 文件的工作记忆 — 每个 scopeId 对应一个 {scope}-{scopeId}.md 文件 */
export class FileWorkingMemory implements WorkingMemory {
  readonly scope: 'user' | 'workspace';
  private dir: string;
  private template: string;

  constructor(options: FileWorkingMemoryOptions) {
    this.dir = options.dir;
    this.scope = options.scope ?? 'user';
    this.template = options.template ?? DEFAULT_TEMPLATE;
  }

  /**
   * 读取工作记忆内容
   *
   * @param scopeId - 作用域标识符
   * @returns 工作记忆的 Markdown 内容，文件不存在时返回空字符串
   */
  async get(scopeId: string): Promise<string> {
    try {
      return await fs.readFile(this.filePath(scopeId), 'utf-8');
    } catch {
      return '';
    }
  }

  /**
   * 全量覆盖写入工作记忆
   *
   * @param scopeId - 作用域标识符
   * @param content - 要写入的 Markdown 内容
   */
  async set(scopeId: string, content: string): Promise<void> {
    await fs.mkdir(this.dir, { recursive: true });
    await fs.writeFile(this.filePath(scopeId), content, 'utf-8');
  }

  getTemplate(): string {
    return this.template;
  }

  private filePath(scopeId: string): string {
    return path.join(this.dir, `${this.scope}-${scopeId}.md`);
  }
}
