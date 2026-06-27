// src/tool/builtin/write-tool.ts
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, relative, dirname } from 'node:path';
import {z} from 'zod';
import {createTool} from '../create-tool.js';
import type {ToolCall, ToolExecutionContext} from '../types.js';

const writeParams = z.object({
  path: z.string().describe('The file path to write (relative to workspace or absolute)'),
  content: z.string().describe('The full content to write to the file'),
});

function resolvePath(workspace: string, targetPath: string): string {
  const abs = targetPath.startsWith('/') ? targetPath : resolve(workspace, targetPath);
  if (!abs.startsWith(resolve(workspace)) && !targetPath.startsWith('/')) {
    throw new Error(`Path "${targetPath}" is outside the workspace`);
  }
  return abs;
}

async function executeWrite(call: ToolCall, ctx: ToolExecutionContext): Promise<string> {
  const args = call.args as unknown as z.infer<typeof writeParams>;

  const absPath = resolvePath(ctx.session.workspace, args.path);
  const dir = dirname(absPath);

  mkdirSync(dir, { recursive: true });

  const existed = existsSync(absPath);
  writeFileSync(absPath, args.content, 'utf-8');

  const rel = relative(ctx.session.workspace, absPath);
  const action = existed ? 'Updated' : 'Created';
  const lines = args.content.split('\n').length;
  const size = Buffer.byteLength(args.content, 'utf-8');

  return `${action} ${rel} (${lines} lines, ${size} bytes)`;
}

export const writeTool = createTool({
  name: 'write',
  description:
    'Create a new file or overwrite an existing file in the workspace. Parent directories are created automatically if they do not exist.',
  inputSchema: writeParams,
  outputSchema: z.string(),
  policy: 'on-request',
  kind: 'file_change',
  tags: ['builtin', 'write'],
  execute: executeWrite,
});
