// @vico/core - FileSemanticMemory: 基于 Markdown 文件的语义记忆实现
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { SemanticMemory } from '../types.js';
import { DEFAULT_SEMANTIC_MEMORY_TEMPLATE } from './default-template.js';
import { KeyedMutex } from '../../utils/async-keyed-lock.js';

/** 构造选项 */
export interface FileSemanticMemoryOptions {
  /** 文件存储目录 */
  dir: string;
  /** Markdown 模板，未提供时使用默认模板 */
  template?: string;
}

/** 基于 Markdown 文件的语义记忆 — 每个 userId 对应一个 user-{userId}.md 文件 */
export class FileSemanticMemory implements SemanticMemory {
  private dir: string;
  private template: string;
  /** 按 scopeId 分片的写锁 — 串行化同一用户的并发写，避免交错覆盖文件 */
  private readonly mutex = new KeyedMutex();

  constructor(options: FileSemanticMemoryOptions) {
    this.dir = options.dir;
    this.template = options.template ?? DEFAULT_SEMANTIC_MEMORY_TEMPLATE;
  }

  /**
   * 读取语义记忆内容
   *
   * @param scopeId - 作用域标识符
   * @returns 语义记忆的 Markdown 内容，文件不存在时返回空字符串
   */
  async get(scopeId: string): Promise<string> {
    try {
      return await fs.readFile(this.filePath(scopeId), 'utf-8');
    } catch {
      return '';
    }
  }

  /**
   * 全量覆盖写入语义记忆
   *
   * @param scopeId - 作用域标识符
   * @param content - 要写入的 Markdown 内容
   */
  async set(scopeId: string, content: string): Promise<void> {
    await this.mutex.run(scopeId, async () => {
      await fs.mkdir(this.dir, { recursive: true });
      await fs.writeFile(this.filePath(scopeId), content, 'utf-8');
    });
  }

  getTemplate(): string {
    return this.template;
  }

  private filePath(scopeId: string): string {
    return path.join(this.dir, `user-${scopeId}.md`);
  }
}
