// @vico/fs-tool — 文件系统操作工具

import type { Tool } from '@vico/tool';
import type { Filesystem } from '@vico/fs';
import { createReadTool } from './read-tool.js';
import { createWriteTool } from './write-tool.js';
import { createEditTool } from './edit-tool.js';
import { createGrepTool } from './grep-tool.js';
import { createGlobTool } from './glob-tool.js';

export { createReadTool } from './read-tool.js';
export { createWriteTool } from './write-tool.js';
export { createEditTool } from './edit-tool.js';
export { createGrepTool } from './grep-tool.js';
export { createGlobTool } from './glob-tool.js';

/**
 * 创建文件系统工具集（需要 workspace）。
 *
 * read/write/edit 依赖注入的 `fs` 端口；glob/grep 用打包的 ripgrep 二进制，不依赖 fs。
 *
 * @param fs - 文件系统实现（由装配层注入，不再默认本地文件系统）
 * @returns 文件系统工具数组
 */
export function createFilesystemTools(fs: Filesystem): Tool[] {
  return [
    createReadTool(fs),
    createWriteTool(fs),
    createEditTool(fs),
    createGrepTool(),
    createGlobTool(),
  ];
}
