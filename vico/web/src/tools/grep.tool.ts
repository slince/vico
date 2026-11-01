/**
 * 内容搜索工具定义（前端）。
 *
 * 对应服务端 packages/fs-tool/src/grep-tool.ts，
 * 参数 schema 与服务端 inputSchema/outputSchema 保持一致。
 */
import {z} from 'zod/v4';
import {Search} from 'lucide-react';
import {GrepRenderer} from './ToolUIs/grep-ui';
import type {ToolRunActivitySummary, VicoToolkitDefinitionEntry} from './tool-summary';

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

/**
 * grep 的 RunActivity 摘要 — 关键参数是正则表达式（有路径时带上路径）。
 */
export function summarizeGrep(args: GrepArgs): ToolRunActivitySummary {
  return {
    icon: Search,
    description: args.path
      ? `Searching ${args.pattern} in ${args.path}`
      : `Searching ${args.pattern}`,
  };
}

export const grepTool: VicoToolkitDefinitionEntry<GrepArgs, GrepResult> = {
  description: '使用正则表达式搜索文件内容。支持 glob 过滤、忽略大小写和上下文行。',
  parameters: grepSchema,
  render: GrepRenderer,
  summarize: summarizeGrep,
};
