// src/memory/working-memory-tool.ts
import type {Tool, ToolCall, ToolExecutionContext} from '../../tool/types.js';
import type {WorkingMemory} from '../types.js';

/** 创建 updateWorkingMemory 工具，绑定 WorkingMemory 实例 */
export function createUpdateWorkingMemoryTool(wm: WorkingMemory): Tool {
  const template = wm.getTemplate();

  return {
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
    execute: async (call: ToolCall, ctx: ToolExecutionContext) => {
      const args = call.args as { memory: string };
      if (!args.memory || typeof args.memory !== 'string') {
        throw new Error('updateWorkingMemory requires a "memory" string argument');
      }
      const scopeId = wm.scope === 'user' ? ctx.session.userId : ctx.session.workspace;
      // 防退化保护：拒绝用空模板覆盖已有数据
      const current = await wm.get(scopeId);
      if (current && args.memory.trim() === template.trim()) {
        throw new Error('Refusing to replace working memory with empty template');
      }
      await wm.set(scopeId, args.memory);
      return 'Working memory updated';
    }
  };
}
