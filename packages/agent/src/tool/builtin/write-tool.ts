// src/tool/builtin/write-tool.ts
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, relative, dirname } from 'node:path';
import type { Tool } from '../types.js';

/** 解析并验证路径在工作区内 */
function resolvePath(workspace: string, targetPath: string): string {
  const abs = targetPath.startsWith('/') ? targetPath : resolve(workspace, targetPath);
  if (!abs.startsWith(resolve(workspace)) && !targetPath.startsWith('/')) {
    throw new Error(`Path "${targetPath}" is outside the workspace`);
  }
  return abs;
}

export const writeTool: Tool = {
  name: 'write',
  description:
    'Create a new file or overwrite an existing file in the workspace. Parent directories are created automatically if they do not exist. Use this to write new files or replace entire file contents.',
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'The file path to write (relative to workspace or absolute)' },
      content: { type: 'string', description: 'The full content to write to the file' },
    },
    required: ['path', 'content'],
  },
  policy: 'on-request',
  kind: 'file_change',
  tags: ['builtin', 'write'],
  async execute(call, ctx) {
    const args = call.args as { path: string; content: string };
    if (!args.path || typeof args.path !== 'string') {
      throw new Error('"path" is required and must be a string');
    }
    if (typeof args.content !== 'string') {
      throw new Error('"content" is required and must be a string');
    }

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
  },
};
