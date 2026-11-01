/**
 * 文件读取工具定义（前端）。
 *
 * 对应服务端 packages/fs-tool/src/read-tool.ts，
 * 参数 schema 与服务端 inputSchema/outputSchema 保持一致。
 */
import {z} from 'zod/v4';
import {FileText} from 'lucide-react';
import {ReadRenderer} from './ToolUIs/read-ui';
import type {ToolRunActivitySummary, VicoToolkitDefinitionEntry} from './tool-summary';

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

/**
 * read 的 RunActivity 摘要 — 关键参数是文件路径。
 */
export function summarizeRead(args: ReadArgs): ToolRunActivitySummary {
  return {
    icon: FileText,
    description: `Reading ${args.path}`,
  };
}

export const readTool: VicoToolkitDefinitionEntry<ReadArgs, ReadResult> = {
  description: '读取工作区文件，支持行偏移和行数限制。图片文件自动检测并以 base64 返回。',
  parameters: readSchema,
  render: ReadRenderer,
  summarize: summarizeRead,
};
