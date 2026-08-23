/**
 * Vico 平台 ToolKit — 聚合所有工具定义。
 *
 * 每个工具完整定义（schema、类型、render、display）在其独立的 .tool.ts 文件中，
 * 此处仅做 defineToolkit 组装。
 */
import {defineToolkit} from '@assistant-ui/react';
import {getWeatherTool} from './get-weather.tool';
import {bashTool} from './bash.tool';
import {knowledgeSearchTool} from './knowledge-search.tool';
import {
  gitStatusTool,
  gitDiffTool,
  gitLogTool,
  gitBranchTool,
  gitCommitTool,
  gitCheckoutTool,
} from './git.tool';
import {readTool, lsTool, findTool, grepTool, writeTool, editTool} from './filesystem.tool';
import {browserNavigateTool, browserSnapshotTool, browserClickTool} from './browser.tool';
import {packageInstallTool, packageRunTool} from './package.tool';
import {echoTool, nowTool, todoWriteTool} from './simple.tool';
import {webFetchTool} from './web-fetch.tool';
import {lspTool} from './lsp.tool';
import {delegateTool} from './delegate.tool';

export const toolkit = defineToolkit({
  'get-weather': getWeatherTool,
  bash: bashTool,
  search_knowledge_base: knowledgeSearchTool,

  // Git
  git_status: gitStatusTool,
  git_diff: gitDiffTool,
  git_log: gitLogTool,
  git_branch: gitBranchTool,
  git_commit: gitCommitTool,
  git_checkout: gitCheckoutTool,

  // Filesystem
  read: readTool,
  ls: lsTool,
  find: findTool,
  grep: grepTool,
  write: writeTool,
  edit: editTool,

  // Browser
  browser_navigate: browserNavigateTool,
  browser_snapshot: browserSnapshotTool,
  browser_click: browserClickTool,

  // Package
  package_install: packageInstallTool,
  package_run: packageRunTool,

  // Simple
  echo: echoTool,
  now: nowTool,
  todo_write: todoWriteTool,

  // Web fetch
  web_fetch: webFetchTool,

  // LSP
  lsp: lspTool,

  // Delegate
  delegate: delegateTool,
});
