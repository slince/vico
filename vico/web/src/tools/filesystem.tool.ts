/**
 * 文件系统工具定义（前端）。
 *
 * 对应 packages/core/src/tool/builtin/filesystem/*.tool.ts。
 * 只读组（read/ls/find/grep）共用 FileReadRenderer，
 * 写组（write/edit）共用 FileWriteRenderer。
 */
import {z} from 'zod/v4';
import type {ToolkitDefinitionEntry} from '@assistant-ui/react';
import {FileReadRenderer} from './ToolUIs/file-read-ui';
import {FileWriteRenderer} from './ToolUIs/file-write-ui';

// ── read ──
const readSchema = z.object({
  path: z.string().describe('要读取的文件路径'),
  offset: z.number().int().min(1).optional().describe('起始行号（从 1 开始）'),
  limit: z.number().int().min(1).optional().describe('最大读取行数'),
});
const readOutputSchema = z.object({
  content: z.string(),
  type: z.enum(['text', 'image', 'binary']),
  path: z.string(),
});
export type ReadArgs = z.infer<typeof readSchema>;
export type ReadResult = z.infer<typeof readOutputSchema>;

// ── ls ──
const lsSchema = z.object({
  path: z.string().optional().describe('要列出内容的目录路径'),
  limit: z.number().int().default(200).describe('返回条目的最大数量'),
});
const lsOutputSchema = z.object({
  entries: z.array(z.string()),
  count: z.number().int(),
  path: z.string(),
});
export type LsArgs = z.infer<typeof lsSchema>;
export type LsResult = z.infer<typeof lsOutputSchema>;

// ── find ──
const findSchema = z.object({
  pattern: z.string().default('*').describe('匹配文件名的 glob 模式'),
  path: z.string().optional().describe('搜索目录'),
  limit: z.number().int().default(200).describe('返回文件的最大数量'),
});
const findOutputSchema = z.object({
  files: z.array(z.string()),
  count: z.number().int(),
});
export type FindArgs = z.infer<typeof findSchema>;
export type FindResult = z.infer<typeof findOutputSchema>;

// ── grep ──
const grepSchema = z.object({
  pattern: z.string().describe('要搜索的正则表达式'),
  path: z.string().optional().describe('搜索目录或文件路径'),
  glob: z.string().optional().describe('文件名过滤的 glob 模式'),
  limit: z.number().int().default(200).describe('返回匹配的最大数量'),
  '-i': z.boolean().optional().describe('忽略大小写'),
  context: z.number().int().optional().describe('每个匹配周围的上下文行数'),
});
const grepOutputSchema = z.object({
  matches: z.string(),
  count: z.number().int(),
});
export type GrepArgs = z.infer<typeof grepSchema>;
export type GrepResult = z.infer<typeof grepOutputSchema>;

// ── write ──
const writeSchema = z.object({
  path: z.string().describe('要写入的文件路径'),
  content: z.string().describe('要写入文件的完整内容'),
});
const writeOutputSchema = z.object({
  action: z.enum(['created', 'updated']),
  path: z.string(),
  lines: z.number().int(),
  size: z.number().int(),
});
export type WriteArgs = z.infer<typeof writeSchema>;
export type WriteResult = z.infer<typeof writeOutputSchema>;

// ── edit ──
const editEntrySchema = z.object({
  oldText: z.string(),
  newText: z.string(),
});
const editSchema = z.object({
  path: z.string().describe('要编辑的文件路径'),
  oldText: z.string().optional(),
  newText: z.string().optional(),
  edits: z.array(editEntrySchema).optional(),
  startLine: z.number().int().min(1).optional(),
  endLine: z.number().int().min(1).optional(),
  newContent: z.string().optional(),
  insertAt: z.number().int().min(0).optional(),
});
const editOutputSchema = z.object({
  path: z.string(),
  replacements: z.number().int(),
  diff: z.string(),
});
export type EditArgs = z.infer<typeof editSchema>;
export type EditResult = z.infer<typeof editOutputSchema>;

export const readTool: ToolkitDefinitionEntry<ReadArgs, ReadResult> = {
  description: '读取工作区文件，支持行偏移和行数限制。图片文件自动检测并以 base64 返回。',
  parameters: readSchema,
  render: FileReadRenderer,
};

export const lsTool: ToolkitDefinitionEntry<LsArgs, LsResult> = {
  description: '列出工作区目录内容，按字母排序，目录以 "/" 结尾标记。',
  parameters: lsSchema,
  render: FileReadRenderer,
};

export const findTool: ToolkitDefinitionEntry<FindArgs, FindResult> = {
  description: '通过 glob 模式在工作区查找文件，按修改时间排序（最新在前）。',
  parameters: findSchema,
  render: FileReadRenderer,
};

export const grepTool: ToolkitDefinitionEntry<GrepArgs, GrepResult> = {
  description: '使用正则表达式搜索文件内容。支持 glob 过滤、忽略大小写和上下文行。',
  parameters: grepSchema,
  render: FileReadRenderer,
};

export const writeTool: ToolkitDefinitionEntry<WriteArgs, WriteResult> = {
  description: '在工作区创建新文件或覆盖已有文件，父目录不存在时自动创建。',
  parameters: writeSchema,
  render: FileWriteRenderer,
};

export const editTool: ToolkitDefinitionEntry<EditArgs, EditResult> = {
  description: '编辑文件，支持字符串替换、行号编辑、行插入三种模式。返回 unified diff。',
  parameters: editSchema,
  render: FileWriteRenderer,
};
