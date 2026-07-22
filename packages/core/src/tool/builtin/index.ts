// src/tool/builtin/index.ts
export { resolveWorkspacePath } from './workspace.js';

// Basic tools
export { echoTool } from './basic/echo-tool.js';
export { nowTool } from './basic/now-tool.js';
export { todoTool } from './basic/todo-tool.js';
export { webFetchTool } from './basic/web-fetch-tool.js';
export { browserNavigateTool, browserSnapshotTool, browserClickTool } from './basic/browser-tool.js';

// Filesystem tools
export { readTool } from './filesystem/read-tool.js';
export { writeTool } from './filesystem/write-tool.js';
export { editTool } from './filesystem/edit-tool.js';
export { grepTool } from './filesystem/grep-tool.js';
export { findTool } from './filesystem/find-tool.js';
export { lsTool } from './filesystem/ls-tool.js';

// Coding tools
export { bashTool } from './coding/bash-tool.js';
export { lspTool } from './coding/lsp-tool.js';
export { gitStatusTool } from './coding/git-status-tool.js';
export { gitDiffTool } from './coding/git-diff-tool.js';
export { gitLogTool } from './coding/git-log-tool.js';
export { gitCommitTool } from './coding/git-commit-tool.js';
export { gitBranchTool } from './coding/git-branch-tool.js';
export { gitCheckoutTool } from './coding/git-checkout-tool.js';
export { packageInstallTool, packageRunTool } from './coding/package-tools.js';
export { createDelegateTool } from './coding/delegate-tool.js';

import { echoTool } from './basic/echo-tool.js';
import { nowTool } from './basic/now-tool.js';
import { todoTool } from './basic/todo-tool.js';
import { webFetchTool } from './basic/web-fetch-tool.js';
import {
  browserNavigateTool,
  browserSnapshotTool,
  browserClickTool,
} from './basic/browser-tool.js';

import { readTool } from './filesystem/read-tool.js';
import { writeTool } from './filesystem/write-tool.js';
import { editTool } from './filesystem/edit-tool.js';
import { grepTool } from './filesystem/grep-tool.js';
import { findTool } from './filesystem/find-tool.js';
import { lsTool } from './filesystem/ls-tool.js';

import { bashTool } from './coding/bash-tool.js';
import { lspTool } from './coding/lsp-tool.js';
import { gitStatusTool } from './coding/git-status-tool.js';
import { gitDiffTool } from './coding/git-diff-tool.js';
import { gitLogTool } from './coding/git-log-tool.js';
import { gitCommitTool } from './coding/git-commit-tool.js';
import { gitBranchTool } from './coding/git-branch-tool.js';
import { gitCheckoutTool } from './coding/git-checkout-tool.js';
import { packageInstallTool, packageRunTool } from './coding/package-tools.js';

import type { Tool } from '../types.js';

/** 基础内置工具（无需 workspace，始终可用） */
export const basicTools: Tool[] = [
  echoTool,
  nowTool,
  todoTool,
  webFetchTool,
  browserNavigateTool,
  browserSnapshotTool,
  browserClickTool,
];

/** 文件系统工具（需要 workspace） */
export const filesystemTools: Tool[] = [
  readTool,
  writeTool,
  editTool,
  grepTool,
  findTool,
  lsTool,
];

/** Coding 工具（需要 workspace）：Git、Shell、LSP、包管理 */
export const codingTools: Tool[] = [
  bashTool,
  lspTool,
  gitStatusTool,
  gitDiffTool,
  gitLogTool,
  gitCommitTool,
  gitBranchTool,
  gitCheckoutTool,
  packageInstallTool,
  packageRunTool,
];

/** @deprecated 使用 basicTools */
export const baseBuiltinTools: Tool[] = basicTools;

/** @deprecated 使用 filesystemTools.concat(codingTools) */
export const fileBuiltinTools: Tool[] = [
  ...filesystemTools,
  ...codingTools,
];

/** 内置工具全集 */
export const coreBuiltinTools: Tool[] = [
  ...basicTools,
  ...filesystemTools,
  ...codingTools,
];
