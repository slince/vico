// @vico/bash-tool — Bash 持久会话执行工具

import type {Tool} from '@vico/tool';
import {bashTool} from './bash-tool.js';

export {bashTool};

/** Coding 工具（需要 workspace）：Shell */
export const codingTools: Tool[] = [bashTool];
