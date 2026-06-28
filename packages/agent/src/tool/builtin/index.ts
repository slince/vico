// src/tool/builtin/index.ts
export { readTool } from './read-tool.js';
export { bashTool } from './bash-tool.js';
export { editTool } from './edit-tool.js';
export { writeTool } from './write-tool.js';
export { grepTool } from './grep-tool.js';
export { findTool } from './find-tool.js';
export { lsTool } from './ls-tool.js';
export { lspTool } from './lsp-tool.js';
export { echoTool } from './echo-tool.js';
export { nowTool } from './now-tool.js';

import { readTool } from './read-tool.js';
import { bashTool } from './bash-tool.js';
import { editTool } from './edit-tool.js';
import { writeTool } from './write-tool.js';
import { grepTool } from './grep-tool.js';
import { findTool } from './find-tool.js';
import { lsTool } from './ls-tool.js';
import { lspTool } from './lsp-tool.js';
import { echoTool } from './echo-tool.js';
import { nowTool } from './now-tool.js';
import type { Tool } from '../types.js';

/** 基础内置工具（无需 workspace） */
export const baseBuiltinTools: Tool[] = [
  echoTool,
  nowTool,
];

/** 文件操作用具（需要 workspace） */
export const fileBuiltinTools: Tool[] = [
  readTool,
  bashTool,
  editTool,
  writeTool,
  grepTool,
  findTool,
  lsTool,
  lspTool,
];

/** 内置工具全集 */
export const coreBuiltinTools: Tool[] = [
  ...baseBuiltinTools,
  ...fileBuiltinTools,
];
