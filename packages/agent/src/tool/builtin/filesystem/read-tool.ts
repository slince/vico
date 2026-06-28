// src/tool/builtin/read-tool.ts
import {readFileSync, statSync} from 'node:fs';
import {relative} from 'node:path';
import {z} from 'zod';
import {createTool} from '../../create-tool.js';
import type {ToolExecutionContext} from '../../types.js';
import {resolveWorkspacePath} from '../workspace.js';

const readParams = z.object({
  path: z.string().describe('要读取的文件路径（相对于工作区或绝对路径）'),
  offset: z.number().int().min(1).optional().describe('起始行号（从 1 开始）'),
  limit: z.number().int().min(1).optional().describe('最大读取行数'),
});

/** 图片扩展名 */
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.svg', '.ico']);

/** MIME 类型映射 */
const MIME_TYPES: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.bmp': 'image/bmp', '.webp': 'image/webp',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};

/**
 * 检测文件是否为二进制文件。
 *
 * 检查缓冲区前 1024 字节中 null 字节的数量，超过 3 个则判定为二进制。
 *
 * @param buffer - 文件内容的 Buffer
 * @returns 如果判定为二进制文件则返回 true
 */
function isBinary(buffer: Buffer): boolean {
  const sample = buffer.subarray(0, Math.min(buffer.length, 1024));
  let nullCount = 0;
  for (const byte of sample) {
    if (byte === 0) nullCount++;
    if (nullCount > 3) return true;
  }
  return false;
}

/**
 * 读取文本文件，返回 cat -n 格式的带行号内容。
 *
 * 支持通过 offset 指定起始行，通过 limit 限制返回行数。
 *
 * @param absPath - 文件的绝对路径
 * @param offset - 起始行号（1-based），默认为 1
 * @param limit - 最大返回行数，不指定则返回全部
 * @returns cat -n 格式的带行号文本内容，若截断则显示剩余行数提示
 */
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

const readOutputSchema = z.object({
  content: z.string(),
  type: z.enum(['text', 'image', 'binary']),
  path: z.string(),
});

type ReadOutput = z.infer<typeof readOutputSchema>;

/**
 * 读取图片文件，返回 base64 编码的 data URI。
 *
 * 根据文件扩展名自动匹配 MIME 类型，返回可直接用于 `<img>` 标签的 data URI。
 *
 * @param absPath - 图片文件的绝对路径
 * @param ext - 文件扩展名（含点号，如 ".png"）
 * @param workspace - 工作区根路径，用于计算相对路径
 * @returns 包含 base64 data URI、类型和相对路径的 ReadOutput 对象
 */
function readImageFile(absPath: string, ext: string, workspace: string): ReadOutput {
  const buffer = readFileSync(absPath);
  const b64 = buffer.toString('base64');
  const mime = MIME_TYPES[ext] ?? 'application/octet-stream';
  const stat = statSync(absPath);
  return {
    content: `data:${mime};base64,${b64}`,
    type: 'image',
    path: relative(workspace, absPath),
  };
}

async function executeRead(args: z.infer<typeof readParams>, ctx: ToolExecutionContext): Promise<ReadOutput> {
  const absPath = resolveWorkspacePath(ctx.session.workspace, args.path);
  const stat = statSync(absPath);

  if (!stat.isFile()) {
    throw new Error(`"${args.path}" is not a file`);
  }

  const ext = absPath.slice(absPath.lastIndexOf('.')).toLowerCase();
  const rel = relative(ctx.session.workspace, absPath);

  if (IMAGE_EXTENSIONS.has(ext)) {
    return readImageFile(absPath, ext, ctx.session.workspace);
  }

  const buffer = readFileSync(absPath);
  if (isBinary(buffer)) {
    return { content: `[Binary file: ${rel} (${stat.size} bytes)]`, type: 'binary', path: rel };
  }

  return { content: readTextFile(absPath, args.offset, args.limit), type: 'text', path: rel };
}

export const readTool = createTool({
  name: 'read',
  description:
    '读取工作区文件，支持行偏移和行数限制。图片文件自动检测并以 base64 返回。用于查看当前工作区文件内容。',
  inputSchema: readParams,
  outputSchema: readOutputSchema,
  policy: 'auto',
  kind: 'readonly',
  tags: ['builtin', 'read'],
  execute: executeRead,
});
