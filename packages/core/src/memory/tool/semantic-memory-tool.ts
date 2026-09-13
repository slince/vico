// @vico/core - semantic-memory-tool: update_semantic_memory 工具定义
import {z} from 'zod';
import {createTool} from '../../tool/create-tool.js';
import type {ToolCallContext} from '../../tool/types.js';
import type {SemanticMemory} from '../types.js';

/** 归一化字符串空白，用于宽松比对模板（忽略换行/空格差异） */
function normalize(s: string): string {
  return s.replace(/\s+/g, '');
}

/**
 * 创建 update_semantic_memory 工具，绑定 SemanticMemory 实例
 *
 * @param sm - SemanticMemory 实例，用于读写语义记忆
 * @returns 返回一个用于更新语义记忆的工具定义
 */
export function createUpdateSemanticMemoryTool(sm: SemanticMemory) {
  return createTool({
    name: 'update_semantic_memory',
    description:
      '用用户事实和上下文更新语义记忆。每当了解到可能日后有用的用户信息时调用此工具。提供完整的 Markdown 内容——它将替换现有语义记忆。',
    inputSchema: z.object({
      memory: z.string().describe('完整的更新后语义记忆内容（Markdown 格式）'),
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
        throw new Error('缺少用户标识，无法更新语义记忆');
      }
      const current = await sm.get(userId);
      // 宽松归一化比对：忽略换行/空格差异，拦截用空模板覆盖已有数据
      if (current && normalize(args.memory) === normalize(sm.getTemplate())) {
        throw new Error('拒绝用空模板替换语义记忆');
      }
      await sm.set(userId, args.memory);
      return { status: 'updated' as const };
    },
  });
}
