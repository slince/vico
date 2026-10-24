// @vico/fs-tool - 编辑文件工具
import { relative } from 'node:path';
import { createPatch, FILE_HEADERS_ONLY } from 'diff';
import { z } from 'zod';
import { localFilesystem, type Filesystem } from '@vico/fs';
import { createTool, resolveWorkspacePath } from '@vico/tool';
import type { ToolCallContext } from '@vico/tool';

const editEntry = z.object({
  oldText: z.string().describe('Literal text to replace'),
  newText: z.string().describe('Replacement text'),
  replaceAll: z.boolean().optional().describe('Replace all occurrences; default false (oldText must be unique)'),
});

const editParams = z.object({
  path: z.string().describe('File path to edit (relative to workspace or absolute)'),
  // 字符串替换模式
  oldText: z.string().optional().describe('Literal text to replace (single-edit mode)'),
  newText: z.string().optional().describe('Replacement text (single-edit mode); empty string deletes the match'),
  replaceAll: z.boolean().optional().describe('Replace all occurrences in single-edit mode; default false (oldText must be unique)'),
  edits: z.array(editEntry).optional().describe('Batch edits'),
  // 行号编辑模式
  startLine: z.number().int().min(1).optional().describe('Start line number (1-based, inclusive)'),
  endLine: z.number().int().min(1).optional().describe('End line number (1-based, inclusive); defaults to startLine'),
  newContent: z.string().optional().describe('New content for the line range (empty string = delete)'),
  insertAt: z.number().int().min(0).optional().describe('Insert new lines after this line (0 = beginning of file)'),
});

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
 * 顺序执行多条字面量替换（每条独立判断唯一性/全替换），返回最终内容与总替换次数。
 */
function applyTextEdits(
  original: string,
  edits: Array<{ oldText: string; newText: string; replaceAll?: boolean }>,
  displayPath: string,
): LiteralEditResult {
  let content = original;
  let replacements = 0;
  for (const edit of edits) {
    const result = applyLiteralEdit(content, edit.oldText, edit.newText, edit.replaceAll ?? false, displayPath);
    content = result.content;
    replacements += result.replacements;
  }
  return { content, replacements };
}

/** 执行行号范围编辑 */
function applyLineEdits(
  original: string,
  startLine: number,
  endLine: number,
  newContent: string,
): string {
  const lines = original.split('\n');
  const start = Math.max(0, startLine - 1);
  const end = Math.min(lines.length, endLine);

  if (start >= lines.length) {
    throw new Error(`startLine ${startLine} is out of range (file has ${lines.length} lines)`);
  }

  // 替换指定行范围：保留 [0..start) + newContent + [end..]
  return [
    ...lines.slice(0, start),
    newContent,
    ...lines.slice(end),
  ].join('\n');
}

/** 执行行号插入 */
function applyLineInsert(original: string, insertAt: number, newContent: string): string {
  if (insertAt === 0) {
    return newContent + '\n' + original;
  }

  const lines = original.split('\n');
  const pos = Math.min(insertAt, lines.length);

  return [
    ...lines.slice(0, pos),
    newContent,
    ...lines.slice(pos),
  ].join('\n');
}

/**
 * 创建 edit 工具 — 支持字符串替换、行号编辑、行插入三种模式。
 * @param fs - 文件系统实现，默认本地文件系统
 */
export function createEditTool(fs: Filesystem = localFilesystem) {
  return createTool({
    name: 'edit',
    description:
      'Edit a file in three modes: 1) string replacement (oldText→newText, oldText must be unique unless replaceAll is true); 2) line-range edit (startLine/endLine + newContent); 3) line insertion (insertAt + newContent). Returns a unified diff.',
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

      let modified: string;
      let replacements: number;

      // 行号插入模式
      if (args.insertAt !== undefined && args.newContent !== undefined) {
        modified = applyLineInsert(original, args.insertAt, normalizeLineEndings(args.newContent));
        replacements = modified === original ? 0 : 1;
      }
      // 行号范围编辑模式
      else if (args.startLine !== undefined && args.newContent !== undefined) {
        const endLine = args.endLine ?? args.startLine;
        modified = applyLineEdits(original, args.startLine, endLine, normalizeLineEndings(args.newContent));
        replacements = modified === original ? 0 : 1;
      }
      // 字符串替换模式
      else {
        const edits = args.edits ?? (
          args.oldText !== undefined
            ? [{ oldText: args.oldText, newText: args.newText ?? '', replaceAll: args.replaceAll }]
            : []
        );

        if (edits.length === 0) {
          throw new Error(
            'Must provide one of: oldText+newText (string replacement), startLine+newContent (line edit), insertAt+newContent (line insertion)',
          );
        }

        const result = applyTextEdits(original, edits, rel);
        modified = result.content;
        replacements = result.replacements;
      }

      await fs.writeFile(absPath, restoreLineEndings(modified, lineEndings));

      const diff = generateDiff(rel, original, modified);

      return { path: rel, replacements, diff };
    },
  });
}

/** edit 工具默认实例（使用本地文件系统） */
export const editTool = createEditTool();
