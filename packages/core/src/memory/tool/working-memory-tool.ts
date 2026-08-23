// src/memory/tool/working-memory-tool.ts
import {z} from 'zod';
import {createTool} from '../../tool/create-tool.js';
import type {ToolCallContext} from '../../tool/types.js';
import type {WorkingMemory} from '../types.js';

/** 归一化字符串空白，用于宽松比对模板（忽略换行/空格差异） */
function normalize(s: string): string {
  return s.replace(/\s+/g, '');
}

/**
 * 创建 update_working_memory 工具，绑定 WorkingMemory 实例
 *
 * @param wm - WorkingMemory 实例，用于读写工作记忆
 * @returns 返回一个用于更新工作记忆的工具定义
 */
export function createUpdateWorkingMemoryTool(wm: WorkingMemory) {
  return createTool({
    name: 'update_working_memory',
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
    async execute(args: { memory: string }, ctx: ToolCallContext) {
      const userId = ctx.session.thread.userId;
      if (!userId) {
        throw new Error('缺少用户标识，无法更新工作记忆');
      }
      const current = await wm.get(userId);
      // 宽松归一化比对：忽略换行/空格差异，拦截用空模板覆盖已有数据
      if (current && normalize(args.memory) === normalize(wm.getTemplate())) {
        throw new Error('拒绝用空模板替换工作记忆');
      }
      await wm.set(userId, args.memory);
      return { status: 'updated' as const };
    },
  });
}
