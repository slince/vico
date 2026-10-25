// @vico/bash-tool — Shell 命令执行工具（bash / pwsh），薄壳委托 @vico/bash

import type { Tool } from '@vico/tool';
import { bashTool, createBashTool } from './bash-tool.js';
import { createPwshTool, pwshTool } from './pwsh-tool.js';

export { bashTool, createBashTool, createPwshTool, pwshTool };

/** Shell 工具（需要 workspace）：按平台选择 Shell（Windows 用 pwsh，其余用 bash） */
export const shellTools: Tool[] = process.platform === 'win32' ? [pwshTool] : [bashTool];

/** PowerShell 工具（需要 workspace）：Windows 主机的 Shell */
export const pwshTools: Tool[] = [pwshTool];
