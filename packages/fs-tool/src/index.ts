// @vico/fs-tool — 文件系统操作工具

import type {Tool} from '@vico/tool';
import {readTool} from './read-tool.js';
import {writeTool} from './write-tool.js';
import {editTool} from './edit-tool.js';
import {grepTool} from './grep-tool.js';
import {globTool} from './glob-tool.js';

export {createReadTool, readTool} from './read-tool.js';
export {createWriteTool, writeTool} from './write-tool.js';
export {createEditTool, editTool} from './edit-tool.js';
export {createGrepTool, grepTool} from './grep-tool.js';
export {createGlobTool, globTool} from './glob-tool.js';

/** 文件系统工具（需要 workspace） */
export const filesystemTools: Tool[] = [
  readTool,
  writeTool,
  editTool,
  grepTool,
  globTool,
];
