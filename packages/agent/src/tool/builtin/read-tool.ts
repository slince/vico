// src/tool/builtin/read-tool.ts
import { readFileSync, statSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import {createTool} from '../create-tool.js';
import type {ToolCall, ToolExecutionContext} from '../types.js';

/** 图片扩展名 */
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.svg', '.ico']);

/** MIME 类型映射 */
const MIME_TYPES: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.bmp': 'image/bmp', '.webp': 'image/webp',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};

interface ReadArgs {
  path: string;
  offset?: number;
  limit?: number;
}

/** 二进制检测：前 1024 字节中 null 字节占比 */
function isBinary(buffer: Buffer): boolean {
  const sample = buffer.subarray(0, Math.min(buffer.length, 1024));
  let nullCount = 0;
  for (const byte of sample) {
    if (byte === 0) nullCount++;
    if (nullCount > 3) return true;
  }
  return false;
}

/** 将工作区路径解析为绝对路径 */
function resolvePath(workspace: string, targetPath: string): string {
  const abs = targetPath.startsWith('/') ? targetPath : resolve(workspace, targetPath);
  if (!abs.startsWith(resolve(workspace)) && !targetPath.startsWith('/')) {
    throw new Error(`Path "${targetPath}" is outside the workspace`);
  }
  return abs;
}

/** 读取文本文件，支持行号偏移和行数限制，返回 cat -n 格式 */
function readTextFile(absPath: string, offset?: number, limit?: number): string {
  const content = readFileSync(absPath, 'utf-8');
  const lines = content.split('\n');
  const start = (offset ?? 1) - 1;
  const end = limit ? start + limit : lines.length;
  const selected = lines.slice(start, end);

  const pad = String(start + selected.length).length;
  const numbered = selected.map((line, i) => {
    const num = String(start + i + 1).padStart(pad, ' ');
    return `${num}\t${line}`;
  });

  if (end < lines.length) {
    numbered.push(`... ${lines.length - end} more lines`);
  }
  return numbered.join('\n');
}

/** 读取图片文件，返回 base64 data URI */
function readImageFile(absPath: string, ext: string, workspace: string): string {
  const buffer = readFileSync(absPath);
  const b64 = buffer.toString('base64');
  const mime = MIME_TYPES[ext] ?? 'application/octet-stream';
  const stat = statSync(absPath);
  return JSON.stringify({
    path: relative(workspace, absPath),
    type: 'image',
    mimeType: mime,
    size: stat.size,
    data: `data:${mime};base64,${b64}`,
  });
}

async function executeRead(call: ToolCall, ctx: ToolExecutionContext): Promise<string> {
  const args = call.args as ReadArgs;
  if (!args.path || typeof args.path !== 'string') {
    throw new Error('"path" is required and must be a string');
  }

  const absPath = resolvePath(ctx.session.workspace, args.path);
  const stat = statSync(absPath);

  if (!stat.isFile()) {
    throw new Error(`"${args.path}" is not a file`);
  }

  const ext = absPath.slice(absPath.lastIndexOf('.')).toLowerCase();

  if (IMAGE_EXTENSIONS.has(ext)) {
    return readImageFile(absPath, ext, ctx.session.workspace);
  }

  const buffer = readFileSync(absPath);
  if (isBinary(buffer)) {
    const rel = relative(ctx.session.workspace, absPath);
    return `[Binary file: ${rel} (${stat.size} bytes)]`;
  }

  return readTextFile(absPath, args.offset, args.limit);
}

export const readTool = createTool({
  name: 'read',
  description:
    'Read a file from the workspace. Supports line offset and line count limits. Image files are automatically detected and returned as base64. Use this to inspect file contents in the current workspace.',
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'The file path to read (relative to workspace or absolute)' },
      offset: { type: 'number', description: 'Line number to start reading from (1-based, default 1)' },
      limit: { type: 'number', description: 'Maximum number of lines to read' },
    },
    required: ['path'],
  },
  policy: 'auto',
  kind: 'readonly',
  tags: ['builtin', 'read'],
  execute: executeRead,
});
