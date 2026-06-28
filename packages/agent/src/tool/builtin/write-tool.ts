// src/tool/builtin/write-tool.ts
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, relative, dirname } from 'node:path';
import {z} from 'zod';
import {createTool} from '../create-tool.js';
import type {ToolExecutionContext} from '../types.js';

const writeParams = z.object({
  path: z.string().describe('要写入的文件路径（相对于工作区或绝对路径）'),
  content: z.string().describe('要写入文件的完整内容'),
});

function resolvePath(workspace: string, targetPath: string): string {
  const abs = targetPath.startsWith('/') ? targetPath : resolve(workspace, targetPath);
  if (!abs.startsWith(resolve(workspace)) && !targetPath.startsWith('/')) {
    throw new Error(`Path "${targetPath}" is outside the workspace`);
  }
  return abs;
}

const writeOutputSchema = z.object({
  action: z.enum(['created', 'updated']),
  path: z.string(),
  lines: z.number().int(),
  size: z.number().int(),
});

async function executeWrite(args: z.infer<typeof writeParams>, ctx: ToolExecutionContext): Promise<z.infer<typeof writeOutputSchema>> {
  const absPath = resolvePath(ctx.session.workspace, args.path);
  const dir = dirname(absPath);

  mkdirSync(dir, { recursive: true });

  const existed = existsSync(absPath);
  writeFileSync(absPath, args.content, 'utf-8');

  const rel = relative(ctx.session.workspace, absPath);
  const action = existed ? 'updated' as const : 'created' as const;
  const lines = args.content.split('\n').length;
  const size = Buffer.byteLength(args.content, 'utf-8');

  return { action, path: rel, lines, size };
}

export const writeTool = createTool({
  name: 'write',
  description:
    '在工作区创建新文件或覆盖已有文件，父目录不存在时自动创建。',
  inputSchema: writeParams,
  outputSchema: writeOutputSchema,
  policy: 'on-request',
  kind: 'file_change',
  tags: ['builtin', 'write'],
  execute: executeWrite,
});
