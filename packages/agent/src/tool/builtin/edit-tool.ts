// src/tool/builtin/edit-tool.ts
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import {z} from 'zod';
import {createTool} from '../create-tool.js';
import type {ToolCall, ToolExecutionContext} from '../types.js';

const editEntry = z.object({
  oldText: z.string().describe('要查找的精确文本'),
  newText: z.string().describe('替换后的文本'),
});

const editParams = z.object({
  path: z.string().describe('要编辑的文件路径（相对于工作区或绝对路径）'),
  oldText: z.string().optional().describe('要替换的精确文本（单次编辑模式）'),
  newText: z.string().optional().describe('替换后的文本（单次编辑模式）'),
  edits: z.array(editEntry).optional().describe('批量编辑项'),
});

function resolvePath(workspace: string, targetPath: string): string {
  const abs = targetPath.startsWith('/') ? targetPath : resolve(workspace, targetPath);
  if (!abs.startsWith(resolve(workspace)) && !targetPath.startsWith('/')) {
    throw new Error(`Path "${targetPath}" is outside the workspace`);
  }
  return abs;
}

/**
 * 生成统一 diff 格式的文本差异。
 *
 * 逐行比较新旧内容，以 `-` 前缀标识删除行，`+` 前缀标识新增行。
 *
 * @param oldContent - 原始文件内容
 * @param newContent - 修改后的文件内容
 * @returns 统一 diff 格式的差异字符串，如无变化则返回 "No changes detected"
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
  return diff.length > 0 ? diff.join('\n') : 'No changes detected';
}

const editOutputSchema = z.object({
  path: z.string(),
  replacements: z.number().int(),
  diff: z.string(),
});

async function executeEdit(call: ToolCall, ctx: ToolExecutionContext): Promise<z.infer<typeof editOutputSchema>> {
  const args = call.args as unknown as z.infer<typeof editParams>;

  const edits = args.edits ?? (
    args.oldText !== undefined
      ? [{ oldText: args.oldText, newText: args.newText ?? '' }]
      : []
  );

  if (edits.length === 0) {
    throw new Error('Either "oldText"+"newText" or "edits" array must be provided');
  }

  const absPath = resolvePath(ctx.session.workspace, args.path);
  const original = readFileSync(absPath, 'utf-8');

  let modified = original;
  for (const edit of edits) {
    const escaped = edit.oldText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const count = (modified.match(new RegExp(escaped, 'g')) || []).length;
    if (count === 0) {
      throw new Error(`oldText not found in file:\n\`\`\`\n${edit.oldText.slice(0, 200)}${edit.oldText.length > 200 ? '...' : ''}\n\`\`\``);
    }
    if (count > 1) {
      throw new Error(`oldText appears ${count} times in the file. Please use a larger string with more surrounding context to make it unique.`);
    }
  }

  for (const edit of edits) {
    modified = modified.replace(edit.oldText, edit.newText);
  }

  writeFileSync(absPath, modified, 'utf-8');

  const rel = relative(ctx.session.workspace, absPath);
  const diff = generateDiff(original, modified);
  return { path: rel, replacements: edits.length, diff };
}

export const editTool = createTool({
  name: 'edit',
  description:
    '通过精确字符串替换编辑文件，支持单次替换（oldText → newText）或通过 edits 数组批量替换。每个 oldText 在文件中必须恰好出现一次，返回 unified diff 格式的变更。',
  inputSchema: editParams,
  outputSchema: editOutputSchema,
  policy: 'on-request',
  kind: 'file_change',
  tags: ['builtin', 'edit'],
  execute: executeEdit,
});
