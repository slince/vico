// src/tool/builtin/todo-tool.ts
import { z } from 'zod';
import { createTool } from '../create-tool.js';
import type { ToolExecutionContext } from '../types.js';

const todoEntry = z.object({
  id: z.string().describe('任务唯一标识'),
  content: z.string().describe('任务描述'),
  status: z.enum(['pending', 'in_progress', 'completed']).describe('任务状态'),
});

const todoParams = z.object({
  tasks: z.array(todoEntry).describe('任务列表（替换当前全部任务）'),
});

const todoOutput = z.object({
  tasks: z.array(todoEntry),
  summary: z.string(),
});

/** per-turn 任务列表，模块级作用域 */
let currentTasks: z.infer<typeof todoEntry>[] = [];

async function executeTodo(args: z.infer<typeof todoParams>, _ctx: ToolExecutionContext) {
  currentTasks = args.tasks;

  const pending = currentTasks.filter((t) => t.status === 'pending').length;
  const inProgress = currentTasks.filter((t) => t.status === 'in_progress').length;
  const completed = currentTasks.filter((t) => t.status === 'completed').length;
  const summary = `总计 ${currentTasks.length} 个任务: ${pending} 待处理, ${inProgress} 进行中, ${completed} 已完成`;

  return { tasks: currentTasks, summary };
}

export const todoTool = createTool({
  name: 'todo_write',
  description:
    '创建和更新结构化任务列表，用于跟踪多步任务的执行进度。每次调用会替换全部任务列表。每个任务包含 id、content 和 status（pending/in_progress/completed）。',
  inputSchema: todoParams,
  outputSchema: todoOutput,
  policy: 'auto',
  kind: 'mutation',
  tags: ['builtin', 'planning'],
  execute: executeTodo,
});
