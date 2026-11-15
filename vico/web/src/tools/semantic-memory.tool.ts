/**
 * 语义记忆更新工具定义（前端）。
 *
 * 对应服务端 packages/memory/src/tool/semantic-memory-tool.ts，
 * 参数 schema 与服务端 inputSchema/outputSchema 保持一致。
 * update_semantic_memory 为 auto mutation（无需审批），
 * 三种模式：append 追加 / replace 选择性替换 / overwrite 全量覆盖。
 */
import {z} from 'zod/v4';
import {Brain} from 'lucide-react';
import {SemanticMemoryRenderer} from './ToolUIs/semantic-memory-ui';
import type {ToolRunActivitySummary, VicoToolkitDefinitionEntry} from './tool-summary';

const semanticMemorySchema = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('append'),
    memory: z.string().describe('要追加到现有记忆末尾的新内容（Markdown 片段）'),
  }),
  z.object({
    mode: z.literal('replace'),
    target: z.string().describe('现有记忆中要被替换的原文片段'),
    replacement: z.string().describe('替换后的新文本；空字符串表示删除该片段'),
  }),
  z.object({
    mode: z.literal('overwrite'),
    memory: z.string().describe('完整的更新后语义记忆内容（Markdown）'),
  }),
]);
const semanticMemoryOutputSchema = z.object({
  status: z.literal('updated'),
});
export type SemanticMemoryArgs = z.infer<typeof semanticMemorySchema>;
export type SemanticMemoryResult = z.infer<typeof semanticMemoryOutputSchema>;

/**
 * update_semantic_memory 的 RunActivity 摘要 — 按模式给出不同动作描述。
 */
export function summarizeSemanticMemory(args: SemanticMemoryArgs): ToolRunActivitySummary {
  const description =
    args.mode === 'append'
      ? 'Appending to semantic memory'
      : args.mode === 'replace'
        ? 'Replacing a semantic memory fragment'
        : 'Overwriting semantic memory';
  return {
    icon: Brain,
    description,
  };
}

export const semanticMemoryTool: VicoToolkitDefinitionEntry<SemanticMemoryArgs, SemanticMemoryResult> = {
  description: '更新语义记忆：append 追加新事实，replace 选择性替换片段，overwrite 全量覆盖。',
  parameters: semanticMemorySchema,
  render: SemanticMemoryRenderer,
  display: "standalone",
  summarize: summarizeSemanticMemory,
};
