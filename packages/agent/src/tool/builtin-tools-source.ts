// src/tool/builtin-tools-source.ts
import {type Tool, ToolExecutionContext} from './types.js';
import type {ToolSource} from './types.js';
import {coreBuiltinTools} from './builtin/index.js';

const ECHO_TOOL: Tool = {
  name: 'echo',
  description: 'Echo back the input. Useful for testing the tool execution pipeline.',
  inputSchema: {
    type: 'object',
    properties: { message: { type: 'string', description: 'Message to echo' } },
    required: ['message'],
  },
  policy: 'auto',
  kind: 'readonly',
  tags: ['builtin'],
  execute: async (call) => (call.args as any).message ?? '',
};

const NOW_TOOL: Tool = {
  name: 'now',
  description: 'Get the current date and time in ISO 8601 format.',
  inputSchema: { type: 'object', properties: {} },
  policy: 'auto',
  kind: 'readonly',
  tags: ['builtin'],
  execute: async () => new Date().toISOString(),
};

/** 框架内置工具集 */
export function createBuiltInToolSource(): ToolSource {
  return {
    name: 'builtin',
    list: async (_ctx: ToolExecutionContext): Promise<Tool[]> => {
      return [ECHO_TOOL, NOW_TOOL, ...coreBuiltinTools];
    },
  };
}

