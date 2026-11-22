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
    'Create and update a structured task list to track progress across multi-step work. Each call replaces the entire list. Each task has an id, content, and status (pending/in_progress/completed).',
  inputSchema: todoParams,
  outputSchema: todoOutput,
  policy: 'auto',
  kind: 'mutation',
  execute: executeTodo,
});
