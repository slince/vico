// src/tool/builtin-tools.ts
import type { Tool } from './types.js';
import { coreBuiltinTools } from './builtin/index.js';

const UPDATE_WORKING_MEMORY_TOOL: Tool = {
  name: 'updateWorkingMemory',
  description:
    'Update the working memory with user facts and context. Call this whenever you learn new information about the user that might be useful later. Provide the complete updated Markdown content — it will replace the existing working memory.',
  inputSchema: {
    type: 'object',
    properties: {
      memory: {
        type: 'string',
        description: 'The complete updated working memory content in Markdown format, matching the template structure.',
      },
    },
    required: ['memory'],
  },
  policy: 'auto',
  kind: 'mutation',
  tags: ['builtin'],
  execute: async () => 'Working memory update not configured',
};

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
      UPDATE_WORKING_MEMORY_TOOL,
      // 7 核心 + 1 可选
      ...coreBuiltinTools,
    ];
  },
};
