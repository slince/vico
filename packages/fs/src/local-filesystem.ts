// @vico/fs - LocalFilesystem: 本地磁盘实现（node:fs/promises）

import * as fs from 'node:fs/promises';
import type { Stats } from 'node:fs';
import type { DirEntry, FileStat } from './filesystem.js';
import { Filesystem } from './filesystem.js';

/** 把 node:fs 的 Stats 映射为最小结构 FileStat */
function toFileStat(stats: Stats): FileStat {
  return {
    isFile: stats.isFile(),
    isDirectory: stats.isDirectory(),
    isSymbolicLink: stats.isSymbolicLink(),
    size: stats.size,
    mtimeMs: stats.mtimeMs,
  };
}

/**
 * 本地文件系统实现 — 基于 `node:fs/promises`，面向本地磁盘路径。
 *
 * 二进制读取返回 `Buffer`（`Uint8Array` 子类），调用点需 Node `Buffer`
 * 特性时可直接 `Buffer.from` 或按需判断。
 */
export class LocalFilesystem extends Filesystem {
  async readFile(path: string): Promise<Uint8Array> {
    return fs.readFile(path);
  }

  async readTextFile(path: string): Promise<string> {
    return fs.readFile(path, 'utf-8');
  }

  async writeFile(path: string, data: string | Uint8Array): Promise<void> {
    await fs.writeFile(path, data);
  }

  async readDir(path: string): Promise<DirEntry[]> {
    const entries = await fs.readdir(path, { withFileTypes: true });
    return entries.map((entry) => ({
      name: entry.name,
      isFile: entry.isFile(),
      isDirectory: entry.isDirectory(),
      isSymbolicLink: entry.isSymbolicLink(),
    }));
  }

  async mkdir(path: string, options?: { recursive?: boolean }): Promise<void> {
    await fs.mkdir(path, { recursive: options?.recursive ?? false });
  }

  async exists(path: string): Promise<boolean> {
    try {
      await fs.stat(path);
      return true;
    } catch {
      return false;
    }
  }

  async stat(path: string): Promise<FileStat> {
    return toFileStat(await fs.stat(path));
  }

  async unlink(path: string): Promise<void> {
    await fs.unlink(path);
  }
}
