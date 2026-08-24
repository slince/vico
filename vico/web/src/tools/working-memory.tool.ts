/**
 * 工作记忆更新工具定义（前端）。
 *
 * 对应服务端 packages/core/src/memory/tool/working-memory-tool.ts，
 * 参数 schema 与服务端 inputSchema/outputSchema 保持一致。
 * update_working_memory 为 auto mutation（无需审批）。
 */
import {z} from 'zod/v4';
import type {ToolkitDefinitionEntry} from '@assistant-ui/react';
import {WorkingMemoryRenderer} from './ToolUIs/working-memory-ui';

const workingMemorySchema = z.object({
  memory: z.string().describe('完整的更新后工作记忆内容（Markdown 格式）'),
});
const workingMemoryOutputSchema = z.object({
  status: z.literal('updated'),
});
export type WorkingMemoryArgs = z.infer<typeof workingMemorySchema>;
export type WorkingMemoryResult = z.infer<typeof workingMemoryOutputSchema>;

export const workingMemoryTool: ToolkitDefinitionEntry<WorkingMemoryArgs, WorkingMemoryResult> = {
  description: '用用户事实和上下文更新工作记忆。提供完整的 Markdown 内容，它将替换现有工作记忆。',
  parameters: workingMemorySchema,
  render: WorkingMemoryRenderer,
};
