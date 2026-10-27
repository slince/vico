// @vico/fs-tool - 编辑文件工具
import { relative } from 'node:path';
import { createPatch, FILE_HEADERS_ONLY } from 'diff';
import { z } from 'zod';
import type { Filesystem } from '@vico/fs';
import { createTool } from '@vico/tool';
import { resolveWorkspacePath } from '@vico/utils';
import type { ToolCallContext } from '@vico/tool';

const editParams = z.object({
  path: z.string().describe('File path to edit (relative to workspace or absolute)'),
  oldText: z.string().describe('Literal text to replace; must be unique in the file unless replaceAll is true'),
  newText: z.string().describe('Replacement text; empty string deletes the match'),
  replaceAll: z.boolean().optional().describe('Replace all occurrences instead of requiring a unique match'),
});

const editOutputSchema = z.object({
  path: z.string(),
  replacements: z.number().int(),
  diff: z.string(),
});

type EditOutput = z.infer<typeof editOutputSchema>;

/** 行尾风格：LF 或 CRLF（编辑全程统一到 LF 基准，写回时还原） */
type LineEndings = 'LF' | 'CRLF';

/** CRLF → LF，作为匹配与 diff 的基准 */
function normalizeLineEndings(content: string): string {
  return content.replaceAll('\r\n', '\n');
}

/** 采样前 4096 字符，按 CRLF 与 LF 的多数判断原文件行尾风格 */
function detectLineEndings(raw: string): LineEndings {
  const sample = raw.slice(0, 4096);
  const crlfCount = sample.split('\r\n').length - 1;
  const lfCount = sample.split('\n').length - 1 - crlfCount;
  return crlfCount > lfCount ? 'CRLF' : 'LF';
}

/** 把 LF 基准的内容还原为原文件行尾风格（LF 原样返回） */
function restoreLineEndings(content: string, lineEndings: LineEndings): string {
  return lineEndings === 'LF' ? content : normalizeLineEndings(content).split('\n').join('\r\n');
}

/** 非重叠计数：纯字面量 indexOf 循环，不做正则 */
function countOccurrences(content: string, needle: string): number {
  let count = 0;
  let index = 0;
  while (true) {
    const found = content.indexOf(needle, index);
    if (found === -1) return count;
    count += 1;
    index = found + needle.length;
  }
}

/** 一次字面量替换的结果 */
interface LiteralEditResult {
  content: string;
  replacements: number;
}

/**
 * 对 LF 基准内容做一次字面量替换（参考 deepseek-harness 的 applyLiteralEdit）：
 * old/new 先归一 LF；空 oldText / 未命中抛错；多处命中且非 replaceAll 抛歧义错误。
 */
function applyLiteralEdit(
  content: string,
  oldString: string,
  newString: string,
  replaceAll: boolean,
  displayPath: string,
): LiteralEditResult {
  const oldNorm = normalizeLineEndings(oldString);
  if (oldNorm.length === 0) {
    throw new Error(`oldText must be a non-empty string (in "${displayPath}")`);
  }
  const newNorm = normalizeLineEndings(newString);
  const replacements = countOccurrences(content, oldNorm);
  if (replacements === 0) {
    throw new Error(
      `oldText not found in file:\n\`\`\`\n${oldString.slice(0, 200)}${oldString.length > 200 ? '...' : ''}\n\`\`\``,
    );
  }
  if (!replaceAll && replacements > 1) {
    throw new Error(
      `oldText appears ${replacements} times in the file; use more context to make it unique, or set replaceAll to replace all occurrences.`,
    );
  }
  return { content: content.split(oldNorm).join(newNorm), replacements };
}

/**
 * 用 `diff` 包（jsdiff）生成 unified diff：`---/+++/@@` 头 + 每侧 3 行上下文。
 * headerOptions 用 FILE_HEADERS_ONLY 去掉 jsdiff 默认的 `Index:`/`===` git 风格头；
 * 不传 oldHeader/newHeader，避免 jsdiff 默认拼时间戳导致输出非确定。
 */
function generateDiff(path: string, oldContent: string, newContent: string): string {
  if (oldContent === newContent) return 'No changes detected';
  return createPatch(path, oldContent, newContent, undefined, undefined, {
    context: 3,
    headerOptions: FILE_HEADERS_ONLY,
  }).trim();
}

/**
 * 创建 edit 工具 — 字面量字符串替换（oldText→newText），一次一处或 replaceAll 全替换。
 * @param fs - 文件系统实现（由装配层注入）
 */
export function createEditTool(fs: Filesystem) {
  return createTool({
    name: 'edit',
    description:
      'Edit an existing file by replacing literal text. oldText must be unique in the file unless replaceAll is true; use empty newText to delete the match. Returns a unified diff.',
    inputSchema: editParams,
    outputSchema: editOutputSchema,
    policy: 'auto',
    kind: 'mutation',
    tags: ['requires-workspace'],
    async execute(args: z.infer<typeof editParams>, ctx: ToolCallContext): Promise<EditOutput> {
      const workspace = ctx.session.workspace!;
      const absPath = resolveWorkspacePath(workspace, args.path);
      const rel = relative(workspace, absPath);

      // 读入后统一到 LF 基准做匹配与 diff，写回前还原原行尾风格
      const raw = await fs.readTextFile(absPath);
      const lineEndings = detectLineEndings(raw);
      const original = normalizeLineEndings(raw);

      const { content: modified, replacements } = applyLiteralEdit(
        original,
        args.oldText,
        args.newText,
        args.replaceAll ?? false,
        rel,
      );

      await fs.writeFile(absPath, restoreLineEndings(modified, lineEndings));

      const diff = generateDiff(rel, original, modified);

      return { path: rel, replacements, diff };
    },
  });
}
