// src/tool/builtin/todo-tool.ts
import {z} from 'zod';
import {createTool} from '../create-tool.js';
import type {ToolCallContext} from '../types.js';

const todoEntry = z.object({
  id: z.string().describe('Unique identifier for the task'),
  content: z.string().describe('Task description'),
  status: z.enum(['pending', 'in_progress', 'completed']).describe('Task status'),
});

const todoParams = z.object({
  tasks: z.array(todoEntry).describe('Task list (replaces the entire current list)'),
});

const todoOutput = z.object({
  tasks: z.array(todoEntry),
  summary: z.string(),
});

/** per-turn 任务列表，模块级作用域 */
let currentTasks: z.infer<typeof todoEntry>[] = [];

async function executeTodo(args: z.infer<typeof todoParams>, _ctx: ToolCallContext) {
  currentTasks = args.tasks;

  const pending = currentTasks.filter((t) => t.status === 'pending').length;
  const inProgress = currentTasks.filter((t) => t.status === 'in_progress').length;
  const completed = currentTasks.filter((t) => t.status === 'completed').length;
  const summary = `Total ${currentTasks.length} tasks: ${pending} pending, ${inProgress} in progress, ${completed} completed`;

  return { tasks: currentTasks, summary };
}

export const todoTool = createTool({
  name: 'todo_write',
  description:
    'Create and update a structured task list to track progress across multi-step work. Each call replaces the entire list. Each task has an id, content, and status (pending/in_progress/completed).',
  inputSchema: todoParams,
  outputSchema: todoOutput,
  policy: 'auto',
  kind: 'mutation',
  execute: executeTodo,
});
