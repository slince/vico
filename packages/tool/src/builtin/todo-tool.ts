// src/tool/builtin/todo-tool.ts
import {z} from 'zod';
import {createTool} from '../create-tool.js';
import type {ToolCallContext} from '../types.js';

const todoEntry = z.object({
  id: z.string().describe('Stable identifier for the task; reuse the same id across calls to update a task'),
  content: z.string().describe('Short, concrete description of the task'),
  status: z.enum(['pending', 'in_progress', 'completed']).describe('Task status; at most one task should be in_progress at a time'),
});

const todoParams = z.object({
  tasks: z.array(todoEntry).describe('Complete task list (replaces the entire current list); pass an empty array to clear all tasks'),
});

const todoOutput = z.object({
  tasks: z.array(todoEntry),
  summary: z.string(),
});

async function executeTodo(args: z.infer<typeof todoParams>, ctx: ToolCallContext) {
  const tasks = args.tasks;

  // 任务清单写入当前 turn 的 metadata 并显式持久化（threadStore 由引擎注入）。
  // 依赖 TurnMetadata 的索引签名扩展，无需在类型上显式声明 todos 字段；
  // 每次调用整体替换，跨 step 多次调用覆盖更新，暂停/恢复后仍保留
  const metadata = ctx.session.turn.metadata ?? (ctx.session.turn.metadata = {});
  metadata.todos = tasks;
  await ctx.threadStore.updateTurn(ctx.session.turn.id, { metadata });

  const pending = tasks.filter((t) => t.status === 'pending').length;
  const inProgress = tasks.filter((t) => t.status === 'in_progress').length;
  const completed = tasks.filter((t) => t.status === 'completed').length;
  const summary = `Total ${tasks.length} tasks: ${pending} pending, ${inProgress} in progress, ${completed} completed`;

  return { tasks, summary };
}

export const todoTool = createTool({
  name: 'todo_write',
  description:
    'Create and maintain a task list for multi-step work. Use it when the user gives a complex task (3+ distinct steps), a numbered or comma-separated list of tasks, or asks to track progress. Update it silently — never announce or narrate todo changes to the user. Each call REPLACES the entire list with the tasks you provide, so always include every current task, not just the one that changed. Give each task a stable, readable id (e.g. "1", "2", "3") and reuse the same id across calls. Mark the task you are working on as in_progress (at most one), and mark it completed as soon as it is done. Pass an empty tasks array to clear the list.',
  inputSchema: todoParams,
  outputSchema: todoOutput,
  policy: 'never',
  kind: 'mutation',
  execute: executeTodo,
});
