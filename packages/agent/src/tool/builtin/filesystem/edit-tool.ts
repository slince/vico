// src/tool/builtin/edit-tool.ts
import {readFileSync, writeFileSync} from 'node:fs';
import {relative} from 'node:path';
import {z} from 'zod';
import {createTool} from '../../create-tool.js';
import type {ToolCallContext} from '../../types.js';
import {resolveWorkspacePath} from '../workspace.js';

const editEntry = z.object({
  oldText: z.string().describe('要查找的精确文本'),
  newText: z.string().describe('替换后的文本'),
});

const editParams = z.object({
  path: z.string().describe('要编辑的文件路径（相对于工作区或绝对路径）'),
  // 字符串替换模式
  oldText: z.string().optional().describe('要替换的精确文本（单次编辑模式）'),
  newText: z.string().optional().describe('替换后的文本（单次编辑模式）'),
  edits: z.array(editEntry).optional().describe('批量编辑项'),
  // 行号编辑模式
  startLine: z.number().int().min(1).optional().describe('起始行号（1-based，包含）'),
  endLine: z.number().int().min(1).optional().describe('结束行号（1-based，包含），不指定则与 startLine 相同'),
  newContent: z.string().optional().describe('替换指定行范围的新内容（空字符串=删除）'),
  insertAt: z.number().int().min(0).optional().describe('在指定行后插入新行（0=文件开头）'),
});

/**
 * 生成统一 diff 格式的文本差异。
 */
function generateDiff(oldContent: string, newContent: string): string {
  const oldLines = oldContent.split('\n');
  const newLines = newContent.split('\n');
  const diff: string[] = [];
  let i = 0;
  while (i < oldLines.length && i < newLines.length) {
    if (oldLines[i] !== newLines[i]) {
      diff.push(`-${oldLines[i]}`);
      diff.push(`+${newLines[i]}`);
    }
    i++;
  }
  while (i < oldLines.length) {
    diff.push(`-${oldLines[i++]}`);
  }
  while (i < newLines.length) {
    diff.push(`+${newLines[i++]}`);
  }
  return diff.length > 0 ? diff.join('\n') : '未检测到变更';
}

const editOutputSchema = z.object({
  path: z.string(),
  replacements: z.number().int(),
  diff: z.string(),
});

/** 执行字符串替换编辑 */
function applyTextEdits(original: string, edits: Array<{ oldText: string; newText: string }>): string {
  let modified = original;

  // 先做唯一性检查（基于当前修改后的内容）
  for (const edit of edits) {
    const escaped = edit.oldText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const count = (modified.match(new RegExp(escaped, 'g')) || []).length;
    if (count === 0) {
      throw new Error(
        `文件中未找到 oldText:\n\`\`\`\n${edit.oldText.slice(0, 200)}${edit.oldText.length > 200 ? '...' : ''}\n\`\`\``,
      );
    }
    if (count > 1) {
      throw new Error(
        `oldText 在文件中出现了 ${count} 次，请使用更完整的上下文使其唯一。`,
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
    throw new Error(`startLine ${startLine} 超出文件行数范围（共 ${lines.length} 行）`);
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

async function executeEdit(
  args: z.infer<typeof editParams>,
  ctx: ToolCallContext,
): Promise<z.infer<typeof editOutputSchema>> {
  const workspace = ctx.session.workspace!;
  const absPath = resolveWorkspacePath(workspace, args.path);
  const original = readFileSync(absPath, 'utf-8');

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
        '必须提供以下模式之一：oldText+newText（字符串替换）、startLine+newContent（行号编辑）、insertAt+newContent（行插入）',
      );
    }

    modified = applyTextEdits(original, edits);
  }

  writeFileSync(absPath, modified, 'utf-8');

  const rel = relative(workspace, absPath);
  const diff = generateDiff(original, modified);
  const replacements = (modified.split('\n').length !== original.split('\n').length) ||
    modified !== original ? 1 : 0;

  return { path: rel, replacements, diff };
}

export const editTool = createTool({
  name: 'edit',
  description:
    '编辑文件，支持三种模式：1) 字符串替换（oldText→newText，oldText 须在文件中唯一）；2) 行号编辑（startLine/endLine+newContent 替换指定行范围）；3) 行插入（insertAt+newContent 在指定行后插入）。返回 unified diff。',
  inputSchema: editParams,
  outputSchema: editOutputSchema,
  policy: 'on-request',
  kind: 'file_change',
  tags: ['builtin', 'edit'],
  execute: executeEdit,
});
