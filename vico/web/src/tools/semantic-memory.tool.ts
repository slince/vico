/**
 * 语义记忆更新工具定义（前端）。
 *
 * 对应服务端 packages/core/src/memory/tool/semantic-memory-tool.ts，
 * 参数 schema 与服务端 inputSchema/outputSchema 保持一致。
 * update_semantic_memory 为 auto mutation（无需审批）。
 */
import {z} from 'zod/v4';
import {Brain} from 'lucide-react';
import {SemanticMemoryRenderer} from './ToolUIs/semantic-memory-ui';
import type {ToolRunActivitySummary, VicoToolkitDefinitionEntry} from './tool-summary';

const semanticMemorySchema = z.object({
  memory: z.string().describe('完整的更新后语义记忆内容（Markdown 格式）'),
});
const semanticMemoryOutputSchema = z.object({
  status: z.literal('updated'),
});
export type SemanticMemoryArgs = z.infer<typeof semanticMemorySchema>;
export type SemanticMemoryResult = z.infer<typeof semanticMemoryOutputSchema>;

/**
 * update_semantic_memory 的 RunActivity 摘要 — 关键参数是记忆内容（Markdown）。
 */
export function summarizeSemanticMemory(args: SemanticMemoryArgs): ToolRunActivitySummary {
  return {
    icon: Brain,
    description: args.memory,
  };
}

export const semanticMemoryTool: VicoToolkitDefinitionEntry<SemanticMemoryArgs, SemanticMemoryResult> = {
  description: '用用户事实和上下文更新语义记忆。提供完整的 Markdown 内容，它将替换现有语义记忆。',
  parameters: semanticMemorySchema,
  render: SemanticMemoryRenderer,
  display: "standalone",
  summarize: summarizeSemanticMemory,
};
