// @vico/browser-tool — 基于 Playwright 的浏览器工具

import type {Tool} from '@vico/tool';
import {browserNavigateTool} from './browser-navigate-tool.js';
import {browserSnapshotTool} from './browser-snapshot-tool.js';
import {browserClickTool} from './browser-click-tool.js';

export {browserNavigateTool, browserSnapshotTool, browserClickTool};

/** 浏览器工具（可选依赖 Playwright，未安装时返回安装提示） */
export const browserTools: Tool[] = [
  browserNavigateTool,
  browserSnapshotTool,
  browserClickTool,
];
