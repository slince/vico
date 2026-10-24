// @vico/fs-tool - 编辑文件工具
import { relative } from 'node:path';
import { createPatch, FILE_HEADERS_ONLY } from 'diff';
import { z } from 'zod';
import { localFilesystem, type Filesystem } from '@vico/fs';
import { createTool, resolveWorkspacePath } from '@vico/tool';
import type { ToolCallContext } from '@vico/tool';

const editEntry = z.object({
  oldText: z.string().describe('Exact text to find'),
  newText: z.string().describe('Replacement text'),
});

const editParams = z.object({
  path: z.string().describe('File path to edit (relative to workspace or absolute)'),
  // 字符串替换模式
  oldText: z.string().optional().describe('Exact text to replace (single-edit mode)'),
  newText: z.string().optional().describe('Replacement text (single-edit mode)'),
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

/** 执行字符串替换编辑 */
function applyTextEdits(original: string, edits: Array<{ oldText: string; newText: string }>): string {
  let modified = original;

  // 先做唯一性检查（基于当前修改后的内容）
  for (const edit of edits) {
    const escaped = edit.oldText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const count = (modified.match(new RegExp(escaped, 'g')) || []).length;
    if (count === 0) {
      throw new Error(
        `oldText not found in file:\n\`\`\`\n${edit.oldText.slice(0, 200)}${edit.oldText.length > 200 ? '...' : ''}\n\`\`\``,
      );
    }
    if (count > 1) {
      throw new Error(
        `oldText appears ${count} times in the file; use more context to make it unique.`,
      );
    }
  }

  for (const edit of edits) {
    modified = modified.replace(edit.oldText, edit.newText);
  }

  return modified;
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
      'Edit a file in three modes: 1) string replacement (oldText→newText, oldText must be unique in the file); 2) line-range edit (startLine/endLine + newContent); 3) line insertion (insertAt + newContent). Returns a unified diff.',
    inputSchema: editParams,
    outputSchema: editOutputSchema,
    policy: 'auto',
    kind: 'mutation',
    tags: ['requires-workspace'],
    async execute(args: z.infer<typeof editParams>, ctx: ToolCallContext): Promise<EditOutput> {
      const workspace = ctx.session.workspace!;
      const absPath = resolveWorkspacePath(workspace, args.path);
      const original = await fs.readTextFile(absPath);

      let modified: string;

      // 行号插入模式
      if (args.insertAt !== undefined && args.newContent !== undefined) {
        modified = applyLineInsert(original, args.insertAt, args.newContent);
      }
      // 行号范围编辑模式
      else if (args.startLine !== undefined && args.newContent !== undefined) {
        const endLine = args.endLine ?? args.startLine;
        modified = applyLineEdits(original, args.startLine, endLine, args.newContent);
      }
      // 字符串替换模式
      else {
        const edits = args.edits ?? (
          args.oldText !== undefined
            ? [{ oldText: args.oldText, newText: args.newText ?? '' }]
            : []
        );

        if (edits.length === 0) {
          throw new Error(
            'Must provide one of: oldText+newText (string replacement), startLine+newContent (line edit), insertAt+newContent (line insertion)',
          );
        }

        modified = applyTextEdits(original, edits);
      }

      await fs.writeFile(absPath, modified);

      const rel = relative(workspace, absPath);
      const diff = generateDiff(rel, original, modified);
      const replacements = (modified.split('\n').length !== original.split('\n').length) ||
        modified !== original ? 1 : 0;

      return { path: rel, replacements, diff };
    },
  });
}

/** edit 工具默认实例（使用本地文件系统） */
export const editTool = createEditTool();
