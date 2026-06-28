// src/tool/builtin/ls-tool.ts
import { readdirSync, statSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import {z} from 'zod';
import {createTool} from '../create-tool.js';
import type {ToolCall, ToolExecutionContext} from '../types.js';

const lsParams = z.object({
  path: z.string().optional().describe('要列出内容的目录路径'),
  limit: z.number().int().default(200).describe('返回条目的最大数量'),
});

function resolvePath(workspace: string, targetPath: string): string {
  const abs = targetPath.startsWith('/') ? targetPath : resolve(workspace, targetPath);
  if (!abs.startsWith(resolve(workspace)) && !targetPath.startsWith('/')) {
    throw new Error(`Path "${targetPath}" is outside the workspace`);
  }
  return abs;
}

const lsOutputSchema = z.object({
  entries: z.array(z.string()),
  count: z.number().int(),
  path: z.string(),
});

async function executeLs(call: ToolCall, ctx: ToolExecutionContext): Promise<z.infer<typeof lsOutputSchema>> {
  const args = call.args as unknown as z.infer<typeof lsParams>;
  const absPath = args.path ? resolvePath(ctx.session.workspace, args.path) : resolve(ctx.session.workspace, '.');

  const stat = statSync(absPath);
  if (!stat.isDirectory()) {
    throw new Error(`"${args.path ?? '.'}" is not a directory`);
  }

  const entries = readdirSync(absPath, { withFileTypes: true });
  const sorted = entries
    .map((d) => d.isDirectory() ? `${d.name}/` : d.name)
    .sort((a, b) => {
      const aDir = a.endsWith('/');
      const bDir = b.endsWith('/');
      if (aDir !== bDir) return aDir ? -1 : 1;
      return a.localeCompare(b);
    });

  const truncated = sorted.slice(0, args.limit);
  const rel = args.path ? relative(ctx.session.workspace, absPath) : '.';

  return { entries: truncated, count: sorted.length, path: rel };
}

export const lsTool = createTool({
  name: 'ls',
  description:
    '列出工作区目录内容，按字母排序，目录以 "/" 结尾标记。用于探索项目文件结构。',
  inputSchema: lsParams,
  outputSchema: lsOutputSchema,
  policy: 'auto',
  kind: 'readonly',
  tags: ['builtin', 'read'],
  execute: executeLs,
});
