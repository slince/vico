// src/memory/working-memory-tool.ts
import type { Tool, ToolCall, ToolExecutionContext } from '../tool/types.js';
import type { WorkingMemory } from './types.js';

/** updateWorkingMemory 工具定义 */
export const UPDATE_WORKING_MEMORY_TOOL: Tool = {
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

/** 创建 updateWorkingMemory 的实际 handler（由 AgentLoop 注册到 ToolBroker） */
export function createWorkingMemoryHandler(wm: WorkingMemory): { execute: Tool['execute'] } {
  const template = wm.getTemplate();

  return {
    execute: async (call: ToolCall, ctx: ToolExecutionContext) => {
      const args = call.args as { memory: string };
      if (!args.memory || typeof args.memory !== 'string') {
        throw new Error('updateWorkingMemory requires a "memory" string argument');
      }
      const scopeId = wm.scope === 'user' ? ctx.userId : ctx.workspace;
      // 防退化保护：拒绝用空模板覆盖已有数据
      const current = await wm.get(scopeId);
      if (current && args.memory.trim() === template.trim()) {
        throw new Error('Refusing to replace working memory with empty template');
      }
      await wm.set(scopeId, args.memory);
      return 'Working memory updated';
    },
  };
}
