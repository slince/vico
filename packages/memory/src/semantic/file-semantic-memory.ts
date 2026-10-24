// @vico/memory - FileSemanticMemory: 基于 Markdown 文件的语义记忆实现
import * as path from 'node:path';
import type { SemanticMemory } from '../types.js';
import { DEFAULT_SEMANTIC_MEMORY_TEMPLATE } from './default-template.js';
import { KeyedMutex } from '@vico/utils';
import { localFilesystem, type Filesystem } from '@vico/fs';

/** 构造选项 */
export interface FileSemanticMemoryOptions {
  /** 文件存储目录 */
  dir: string;
  /** Markdown 模板，未提供时使用默认模板 */
  template?: string;
  /** 文件系统实现，默认本地文件系统 */
  fs?: Filesystem;
}

/** 基于 Markdown 文件的语义记忆 — 每个 userId 对应一个 user-{userId}.md 文件 */
export class FileSemanticMemory implements SemanticMemory {
  private dir: string;
  private template: string;
  private fs: Filesystem;
  /** 按 scopeId 分片的写锁 — 串行化同一用户的并发写，避免交错覆盖文件 */
  private readonly mutex = new KeyedMutex();

  constructor(options: FileSemanticMemoryOptions) {
    this.dir = options.dir;
    this.template = options.template ?? DEFAULT_SEMANTIC_MEMORY_TEMPLATE;
    this.fs = options.fs ?? localFilesystem;
  }

  /**
   * 读取语义记忆内容
   *
   * @param scopeId - 作用域标识符
   * @returns 语义记忆的 Markdown 内容，文件不存在时返回空字符串
   */
  async get(scopeId: string): Promise<string> {
    try {
      return await this.fs.readTextFile(this.filePath(scopeId));
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
      await this.fs.mkdir(this.dir, { recursive: true });
      await this.fs.writeFile(this.filePath(scopeId), content);
    });
  }

  getTemplate(): string {
    return this.template;
  }

  private filePath(scopeId: string): string {
    return path.join(this.dir, `user-${scopeId}.md`);
  }
}
