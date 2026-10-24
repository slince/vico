// @vico/bash-tool — 持久会话 Shell 执行工具（bash / pwsh）

import type {Tool} from '@vico/tool';
import {bashTool} from './bash-tool.js';
import {pwshTool} from './pwsh-tool.js';

export {bashTool};
export {pwshTool};

/** Coding 工具（需要 workspace）：Shell */
export const codingTools: Tool[] = [bashTool];

/** PowerShell 工具（需要 workspace）：Windows 主机的 Shell */
export const pwshTools: Tool[] = [pwshTool];
