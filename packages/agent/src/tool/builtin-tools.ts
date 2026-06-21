// src/tool/builtin-tools.ts
import type {Tool} from './types.js';
import {coreBuiltinTools} from './builtin/index.js';

/** 框架内置工具集 */
export const BuiltinTools: { list(): Tool[] } = {
  list(): Tool[] {
    return [
      {
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
      },
      {
        name: 'now',
        description: 'Get the current date and time in ISO 8601 format.',
        inputSchema: { type: 'object', properties: {} },
        policy: 'auto',
        kind: 'readonly',
        tags: ['builtin'],
        execute: async () => new Date().toISOString(),
      },
      // 7 核心 + 1 可选
      ...coreBuiltinTools,
    ];
  },
};
