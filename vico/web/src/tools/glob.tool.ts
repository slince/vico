/**
 * 文件查找工具定义（前端）。
 *
 * 对应服务端 packages/fs-tool/src/glob-tool.ts，
 * 参数 schema 与服务端 inputSchema/outputSchema 保持一致。
 */
import {z} from 'zod/v4';
import {FileSearch} from 'lucide-react';
import {GlobRenderer} from './ToolUIs/glob-ui';
import type {ToolRunActivitySummary, VicoToolkitDefinitionEntry} from './tool-summary';

const globSchema = z.object({
  pattern: z.string().default('*').describe('匹配文件名的 glob 模式'),
  path: z.string().optional().describe('搜索目录'),
  limit: z.number().int().default(200).describe('返回文件的最大数量'),
});
const globOutputSchema = z.object({
  root: z.string(),
  paths: z.array(z.string()),
});
export type GlobArgs = z.infer<typeof globSchema>;
export type GlobResult = z.infer<typeof globOutputSchema>;

/**
 * glob 的 RunActivity 摘要 — 关键参数是匹配模式。
 */
export function summarizeGlob(args: GlobArgs): ToolRunActivitySummary {
  return {
    icon: FileSearch,
    description: `Searching files matching ${args.pattern}`,
  };
}

export const globTool: VicoToolkitDefinitionEntry<GlobArgs, GlobResult> = {
  description: '通过 glob 模式在工作区查找文件，按修改时间排序（最新在前）。',
  parameters: globSchema,
  render: GlobRenderer,
  summarize: summarizeGlob,
};
