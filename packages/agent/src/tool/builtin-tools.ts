// src/tool/builtin-tools.ts
import type { ToolSpec } from '../contracts/tool.js';

/** 框架内置工具集 */
export const BuiltinTools: { list(): ToolSpec[] } = {
  list(): ToolSpec[] {
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
      },
      {
        name: 'now',
        description: 'Get the current date and time in ISO 8601 format.',
        inputSchema: { type: 'object', properties: {} },
        policy: 'auto',
        kind: 'readonly',
      },
    ];
  },
};
