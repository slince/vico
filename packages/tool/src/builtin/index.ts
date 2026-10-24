// src/tool/builtin/index.ts
export { resolveWorkspacePath } from './workspace.js';

// Basic tools
export { todoTool } from './basic/todo-tool.js';
export { webFetchTool } from './basic/web-fetch-tool.js';
export { askUserTool } from './basic/ask-user-tool.js';
export { browserNavigateTool, browserSnapshotTool, browserClickTool } from './basic/browser-tool.js';

import { todoTool } from './basic/todo-tool.js';
import { webFetchTool } from './basic/web-fetch-tool.js';
import { askUserTool } from './basic/ask-user-tool.js';
import {
  browserNavigateTool,
  browserSnapshotTool,
  browserClickTool,
} from './basic/browser-tool.js';

import type { Tool } from '../types.js';

/** 基础内置工具（无需 workspace，始终可用） */
export const basicTools: Tool[] = [
  todoTool,
  webFetchTool,
  askUserTool,
  browserNavigateTool,
  browserSnapshotTool,
  browserClickTool,
];

/** @deprecated 使用 basicTools */
export const baseBuiltinTools: Tool[] = basicTools;
