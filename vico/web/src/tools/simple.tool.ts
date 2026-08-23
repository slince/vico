/**
 * 简单工具定义（前端）。
 *
 * 对应服务端 packages/core/src/tool/builtin/basic/{echo,now,todo}-tool.ts，
 * 参数 schema 与服务端 inputSchema/outputSchema 保持一致。
 * echo/now/todo_write 均为 auto（无需审批）。
 */
import {z} from 'zod/v4';
import {SimpleToolRenderer} from './ToolUIs/simple-ui';

// ── echo ──
const echoSchema = z.object({
  message: z.string().describe('要回显的消息'),
});
const echoOutputSchema = z.object({
  message: z.string(),
});
export type EchoArgs = z.infer<typeof echoSchema>;
export type EchoResult = z.infer<typeof echoOutputSchema>;

// ── now ──
const nowSchema = z.object({});
const nowOutputSchema = z.object({
  datetime: z.string().describe('ISO 8601 格式的当前日期和时间'),
});
export type NowArgs = z.infer<typeof nowSchema>;
export type NowResult = z.infer<typeof nowOutputSchema>;

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

export const echoTool = {
  description: '回显输入内容，用于测试工具执行管道。',
  parameters: echoSchema,
  render: SimpleToolRenderer,
};

export const nowTool = {
  description: '获取当前日期和时间（ISO 8601 格式）。',
  parameters: nowSchema,
  render: SimpleToolRenderer,
};

export const todoWriteTool = {
  description: '创建和更新结构化任务列表，用于跟踪多步任务的执行进度。每次调用会替换全部任务列表。',
  parameters: todoWriteSchema,
  render: SimpleToolRenderer,
};
