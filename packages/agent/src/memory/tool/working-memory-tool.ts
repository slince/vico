// src/memory/tool/working-memory-tool.ts
import {z} from 'zod';
import {createTool} from '../../tool/create-tool.js';
import type {ToolCall, ToolExecutionContext} from '../../tool/types.js';
import type {WorkingMemory} from '../types.js';

/**
 * 创建 updateWorkingMemory 工具，绑定 WorkingMemory 实例
 *
 * @param wm - WorkingMemory 实例，用于读写工作记忆
 * @returns 返回一个用于更新工作记忆的工具定义
 */
export function createUpdateWorkingMemoryTool(wm: WorkingMemory) {
  const template = wm.getTemplate();

  return createTool({
    name: 'updateWorkingMemory',
    description:
      '用用户事实和上下文更新工作记忆。每当了解到可能日后有用的用户信息时调用此工具。提供完整的 Markdown 内容——它将替换现有工作记忆。',
    inputSchema: z.object({
      memory: z.string().describe('完整的更新后工作记忆内容（Markdown 格式）'),
    }),
    outputSchema: z.object({
      status: z.literal('updated'),
    }),
    policy: 'auto',
    kind: 'mutation',
    tags: ['builtin'],
    async execute(call: ToolCall, ctx: ToolExecutionContext) {
      const args = call.args as { memory: string };
      const scopeId = wm.scope === 'user' ? ctx.session.thread.userId ?? '' : ctx.session.workspace;
      const current = await wm.get(scopeId);
      if (current && args.memory.trim() === template.trim()) {
        throw new Error('拒绝用空模板替换工作记忆');
      }
      await wm.set(scopeId, args.memory);
      return { status: 'updated' as const };
    },
  });
}
