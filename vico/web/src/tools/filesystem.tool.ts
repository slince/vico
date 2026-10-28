/**
 * 文件系统工具定义（前端）。
 *
 * 对应 packages/tool/src/builtin/filesystem/*.tool.ts。
 * 只读组（read/glob/grep）共用 FileReadRenderer，
 * 写组（write/edit）共用 FileWriteRenderer。
 */
import {z} from 'zod/v4';
import {FilePen, FilePlus, FileSearch, FileText, Search} from 'lucide-react';
import {FileReadRenderer} from './ToolUIs/file-read-ui';
import {FileWriteRenderer} from './ToolUIs/file-write-ui';
import type {ToolRunActivitySummary, VicoToolkitDefinitionEntry} from './tool-summary';

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

// ── glob ──
const globSchema = z.object({
  pattern: z.string().default('*').describe('匹配文件名的 glob 模式'),
  path: z.string().optional().describe('搜索目录'),
  limit: z.number().int().default(200).describe('返回文件的最大数量'),
});
const globOutputSchema = z.object({
  files: z.array(z.string()),
  count: z.number().int(),
});
export type GlobArgs = z.infer<typeof globSchema>;
export type GlobResult = z.infer<typeof globOutputSchema>;

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
const editSchema = z.object({
  path: z.string().describe('要编辑的文件路径'),
  oldText: z.string().describe('要替换的字面量文本；未开启 replaceAll 时必须在文件中唯一'),
  newText: z.string().describe('替换文本；空字符串表示删除匹配'),
  replaceAll: z.boolean().optional().describe('替换所有出现，而不是要求唯一匹配'),
});
const editOutputSchema = z.object({
  path: z.string(),
  replacements: z.number().int(),
  diff: z.string(),
});
export type EditArgs = z.infer<typeof editSchema>;
export type EditResult = z.infer<typeof editOutputSchema>;

export const readTool: VicoToolkitDefinitionEntry<ReadArgs, ReadResult> = {
  description: '读取工作区文件，支持行偏移和行数限制。图片文件自动检测并以 base64 返回。',
  parameters: readSchema,
  render: FileReadRenderer,
  summarize: summarizeRead,
};

export const globTool: VicoToolkitDefinitionEntry<GlobArgs, GlobResult> = {
  description: '通过 glob 模式在工作区查找文件，按修改时间排序（最新在前）。',
  parameters: globSchema,
  render: FileReadRenderer,
  summarize: summarizeGlob,
};

export const grepTool: VicoToolkitDefinitionEntry<GrepArgs, GrepResult> = {
  description: '使用正则表达式搜索文件内容。支持 glob 过滤、忽略大小写和上下文行。',
  parameters: grepSchema,
  render: FileReadRenderer,
  summarize: summarizeGrep,
};

export const writeTool: VicoToolkitDefinitionEntry<WriteArgs, WriteResult> = {
  description: '在工作区创建新文件或覆盖已有文件，父目录不存在时自动创建。',
  parameters: writeSchema,
  render: FileWriteRenderer,
  summarize: summarizeWrite,
};

export const editTool: VicoToolkitDefinitionEntry<EditArgs, EditResult> = {
  description: '通过字面量文本替换编辑文件，一次一处或 replaceAll 全替换。返回 unified diff。',
  parameters: editSchema,
  render: FileWriteRenderer,
  summarize: summarizeEdit,
};

/**
 * read 的 RunActivity 摘要 — 关键参数是文件路径。
 */
export function summarizeRead(args: ReadArgs): ToolRunActivitySummary {
  return {
    icon: FileText,
    description: args.path,
  };
}

/**
 * glob 的 RunActivity 摘要 — 关键参数是匹配模式。
 */
export function summarizeGlob(args: GlobArgs): ToolRunActivitySummary {
  return {
    icon: FileSearch,
    description: args.pattern,
  };
}

/**
 * grep 的 RunActivity 摘要 — 关键参数是正则表达式（有路径时带上路径）。
 */
export function summarizeGrep(args: GrepArgs): ToolRunActivitySummary {
  return {
    icon: Search,
    description: args.path ? `${args.pattern} in ${args.path}` : args.pattern,
  };
}

/**
 * write 的 RunActivity 摘要 — 关键参数是目标文件路径。
 */
export function summarizeWrite(args: WriteArgs): ToolRunActivitySummary {
  return {
    icon: FilePlus,
    description: args.path,
  };
}

/**
 * edit 的 RunActivity 摘要 — 关键参数是被编辑的文件路径。
 */
export function summarizeEdit(args: EditArgs): ToolRunActivitySummary {
  return {
    icon: FilePen,
    description: args.path,
  };
}
