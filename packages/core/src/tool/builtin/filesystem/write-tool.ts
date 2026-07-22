// src/tool/builtin/write-tool.ts
import {existsSync, mkdirSync, writeFileSync} from 'node:fs';
import {dirname, relative} from 'node:path';
import {z} from 'zod';
import {createTool} from '../../create-tool.js';
import type {ToolCallContext} from '../../types.js';
import {resolveWorkspacePath} from '../workspace.js';

const writeParams = z.object({
  path: z.string().describe('要写入的文件路径（相对于工作区或绝对路径）'),
  content: z.string().describe('要写入文件的完整内容'),
});

const writeOutputSchema = z.object({
  action: z.enum(['created', 'updated']),
  path: z.string(),
  lines: z.number().int(),
  size: z.number().int(),
});

async function executeWrite(args: z.infer<typeof writeParams>, ctx: ToolCallContext): Promise<z.infer<typeof writeOutputSchema>> {
  const workspace = ctx.session.workspace!;
  const absPath = resolveWorkspacePath(workspace, args.path);
  const dir = dirname(absPath);

  mkdirSync(dir, { recursive: true });

  const existed = existsSync(absPath);
  writeFileSync(absPath, args.content, 'utf-8');

  const rel = relative(workspace, absPath);
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
  tags: ['builtin', 'write', 'requires-workspace'],
  execute: executeWrite,
});
