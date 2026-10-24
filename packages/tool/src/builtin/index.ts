// src/tool/builtin/index.ts

// Basic tools
export { todoTool } from './todo-tool.js';
export { webFetchTool } from './web-fetch-tool.js';
export { askUserTool } from './ask-user-tool.js';

import { todoTool } from './todo-tool.js';
import { webFetchTool } from './web-fetch-tool.js';
import { askUserTool } from './ask-user-tool.js';

import type { Tool } from '../types.js';

/** 基础内置工具（无需 workspace，始终可用） */
export const basicTools: Tool[] = [
  todoTool,
  webFetchTool,
  askUserTool,
];

/** @deprecated 使用 basicTools */
export const baseBuiltinTools: Tool[] = basicTools;
