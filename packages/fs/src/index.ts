// @vico/fs - 文件系统抽象层

import { Filesystem } from './filesystem.js';
import { LocalFilesystem } from './local-filesystem.js';

export {
  Filesystem,
  type FileStat,
  type DirEntry,
} from './filesystem.js';
export { LocalFilesystem } from './local-filesystem.js';

/** 默认本地文件系统单例 — 各调用点未显式注入时使用 */
export const localFilesystem: Filesystem = new LocalFilesystem();
