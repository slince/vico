// @vico/fs - 文件系统抽象层：Filesystem 端口 + 结构类型

/**
 * 路径元数据（最小结构，不绑定 node:fs.Stats）。
 *
 * 供 `Filesystem.stat` 返回，适配器可按需映射（本地磁盘 / S3 等）。
 */
export interface FileStat {
  isFile: boolean;
  isDirectory: boolean;
  isSymbolicLink: boolean;
  /** 文件大小（字节） */
  size: number;
  /** 最后修改时间（Unix 毫秒时间戳） */
  mtimeMs: number;
}

/**
 * 目录条目（最小结构，不绑定 node:fs.Dirent）。
 *
 * 供 `Filesystem.readDir` 返回，条目仅含名称与类型标注。
 */
export interface DirEntry {
  name: string;
  isFile: boolean;
  isDirectory: boolean;
  isSymbolicLink: boolean;
}

/**
 * 文件系统端口 — 异步、Promise 化的文件操作抽象。
 *
 * 二进制统一用 `Uint8Array`（而非 Node `Buffer`），使适配器不依赖 Node
 * 运行时；需要 Buffer 特性的调用点（base64、pdf-parse 等）自行 `Buffer.from`。
 * 本地实现见 {@link LocalFilesystem}，默认单例见 `@vico/fs` 的 `localFilesystem`。
 */
export abstract class Filesystem {
  /** 读文件二进制内容 */
  abstract readFile(path: string): Promise<Uint8Array>;
  /** 读文件 UTF-8 文本内容 */
  abstract readTextFile(path: string): Promise<string>;
  /** 写文件（UTF-8 字符串或二进制），父目录需已存在或由 {@link mkdir} 创建 */
  abstract writeFile(path: string, data: string | Uint8Array): Promise<void>;
  /** 列目录（不含 `.` 与 `..`），返回带类型标注的条目 */
  abstract readDir(path: string): Promise<DirEntry[]>;
  /** 建目录（recursive 为 true 时递归创建父目录） */
  abstract mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
  /** 判断路径是否存在（语义对齐 `fs.existsSync`：不存在返回 false） */
  abstract exists(path: string): Promise<boolean>;
  /** 取路径元数据 */
  abstract stat(path: string): Promise<FileStat>;
  /** 删除文件 */
  abstract unlink(path: string): Promise<void>;
}
