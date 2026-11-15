// @vico/memory - semantic-memory-tool: update_semantic_memory 工具定义
import {z} from 'zod';
import {createTool} from '@vico/tool';
import type {ToolCallContext} from '@vico/tool';
import type {SemanticMemory} from '../types.js';

/** 归一化字符串空白，用于宽松比对模板（忽略换行/空格差异） */
function normalize(s: string): string {
  return s.replace(/\s+/g, '');
}

/**
 * 三种更新模式的参数 schema — 用 discriminatedUnion 让 LLM 按 mode 看到对应字段：
 *
 * - append：把新事实追加到现有记忆末尾；
 * - replace：选择性替换现有记忆中的某个片段（target → replacement）；
 * - overwrite：全量覆盖为提供的新内容。
 */
const updateSemanticMemorySchema = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('append'),
    memory: z.string().describe('New content (Markdown fragment) to append to the end of the current semantic memory'),
  }),
  z.object({
    mode: z.literal('replace'),
    target: z.string().describe('Exact fragment in the current memory to replace; copy it verbatim from "Current semantic memory" to ensure a match'),
    replacement: z.string().describe('Replacement text for the matched fragment; use an empty string to delete the fragment'),
  }),
  z.object({
    mode: z.literal('overwrite'),
    memory: z.string().describe('The complete updated semantic memory content (Markdown)'),
  }),
]);

type UpdateSemanticMemoryArgs = z.infer<typeof updateSemanticMemorySchema>;

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
      'Update semantic memory with durable, long-term user facts. Call only when you learn stable facts about the user that may be useful later (identity, preferences, goals, constraints). Use "append" to add new facts to the end; "replace" to selectively replace a specific fragment of the current memory; "overwrite" to provide the complete updated memory content. Do not record the current task or any in-progress state.',
    inputSchema: updateSemanticMemorySchema,
    outputSchema: z.object({
      status: z.literal('updated'),
    }),
    policy: 'auto',
    kind: 'mutation',
    async execute(args: UpdateSemanticMemoryArgs, ctx: ToolCallContext) {
      const userId = ctx.session.thread.userId;
      if (!userId) {
        throw new Error('Missing user id; cannot update semantic memory');
      }

      const current = await sm.get(userId);

      switch (args.mode) {
        case 'append': {
          // 追加模式：在现有记忆末尾追加新事实（文件不存在时直接落为新内容）
          const addition = args.memory.trim();
          if (!addition) {
            throw new Error('Append content must not be empty');
          }

          const merged = current ? `${current.trimEnd()}\n\n${addition}` : addition;
          await sm.set(userId, merged);
          return { status: 'updated' as const };
        }

        case 'replace': {
          // 选择性替换：target 须精确命中现有记忆片段，命中处全部替换为 replacement（空串即删除）
          if (!current) {
            throw new Error('No existing semantic memory to replace; use mode "append" or "overwrite" instead');
          }
          if (!args.target) {
            throw new Error('Replace target must not be empty');
          }
          if (!current.includes(args.target)) {
            throw new Error('Target fragment not found in the current semantic memory; copy it verbatim from "Current semantic memory" or use mode "overwrite" instead');
          }

          // split/join 纯字符串操作，避免 target 中的正则元字符被当作正则解析
          await sm.set(userId, current.split(args.target).join(args.replacement));
          return { status: 'updated' as const };
        }

        case 'overwrite': {
          // 全量覆盖：沿用空模板防呆保护（宽松归一化比对，忽略换行/空格差异）
          if (current && normalize(args.memory) === normalize(sm.getTemplate())) {
            throw new Error('Refusing to overwrite semantic memory with the empty template');
          }

          await sm.set(userId, args.memory);
          return { status: 'updated' as const };
        }

        default: {
          // 穷尽性兜底（正常不可达）
          throw new Error('Unknown semantic memory update mode');
        }
      }
    },
  });
}
