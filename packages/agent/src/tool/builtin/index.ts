// src/tool/builtin/index.ts
export { readTool } from './read-tool.js';
export { bashTool } from './bash-tool.js';
export { editTool } from './edit-tool.js';
export { writeTool } from './write-tool.js';
export { grepTool } from './grep-tool.js';
export { findTool } from './find-tool.js';
export { lsTool } from './ls-tool.js';
export { lspTool } from './lsp-tool.js';

import { readTool } from './read-tool.js';
import { bashTool } from './bash-tool.js';
import { editTool } from './edit-tool.js';
import { writeTool } from './write-tool.js';
import { grepTool } from './grep-tool.js';
import { findTool } from './find-tool.js';
import { lsTool } from './ls-tool.js';
import { lspTool } from './lsp-tool.js';
import type { Tool } from '../types.js';

/** 7 个核心 + 1 个可选内置工具 */
export const coreBuiltinTools: Tool[] = [
  readTool,
  bashTool,
  editTool,
  writeTool,
  grepTool,
  findTool,
  lsTool,
  lspTool,
];
