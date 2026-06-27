// src/memory/tool/working-memory-tool.ts
import {z} from 'zod';
import {createTool} from '../../tool/create-tool.js';
import type {ToolCall, ToolExecutionContext} from '../../tool/types.js';
import type {WorkingMemory} from '../types.js';

/** 创建 updateWorkingMemory 工具，绑定 WorkingMemory 实例 */
export function createUpdateWorkingMemoryTool(wm: WorkingMemory) {
  const template = wm.getTemplate();

  return createTool({
    name: 'updateWorkingMemory',
    description:
      'Update the working memory with user facts and context. Call this whenever you learn new information about the user that might be useful later. Provide the complete updated Markdown content — it will replace the existing working memory.',
    inputSchema: z.object({
      memory: z.string().describe('The complete updated working memory content in Markdown format'),
    }),
    policy: 'auto',
    kind: 'mutation',
    tags: ['builtin'],
    async execute(call: ToolCall, ctx: ToolExecutionContext) {
      const args = call.args as { memory: string };
      const scopeId = wm.scope === 'user' ? ctx.session.thread.userId ?? '' : ctx.session.workspace;
      const current = await wm.get(scopeId);
      if (current && args.memory.trim() === template.trim()) {
        throw new Error('Refusing to replace working memory with empty template');
      }
      await wm.set(scopeId, args.memory);
      return 'Working memory updated';
    },
  });
}
