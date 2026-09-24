/**
 * 简单工具定义（前端）。
 *
 * 对应服务端 packages/core/src/tool/builtin/basic/todo-tool.ts，
 * 参数 schema 与服务端 inputSchema/outputSchema 保持一致。
 * todo_write 为 auto（无需审批）。
 */
import {z} from 'zod/v4';
import type {ToolkitDefinitionEntry} from '@assistant-ui/react';
import {SimpleToolRenderer} from './ToolUIs/simple-ui';

// ── todo_write ──
const todoEntrySchema = z.object({
  id: z.string().describe('任务唯一标识'),
  content: z.string().describe('任务描述'),
  status: z.enum(['pending', 'in_progress', 'completed']).describe('任务状态'),
});
const todoWriteSchema = z.object({
  tasks: z.array(todoEntrySchema).describe('任务列表（替换当前全部任务）'),
});
const todoWriteOutputSchema = z.object({
  tasks: z.array(todoEntrySchema),
  summary: z.string(),
});
export type TodoWriteArgs = z.infer<typeof todoWriteSchema>;
export type TodoWriteResult = z.infer<typeof todoWriteOutputSchema>;

export const todoWriteTool: ToolkitDefinitionEntry<TodoWriteArgs, TodoWriteResult> = {
  description: '创建和更新结构化任务列表，用于跟踪多步任务的执行进度。每次调用会替换全部任务列表。',
  parameters: todoWriteSchema,
  render: SimpleToolRenderer,
};
