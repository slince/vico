/**
 * 文件写入工具定义（前端）。
 *
 * 对应服务端 packages/fs-tool/src/write-tool.ts，
 * 参数 schema 与服务端 inputSchema/outputSchema 保持一致。
 */
import {z} from 'zod/v4';
import {FilePlus} from 'lucide-react';
import {WriteRenderer} from './ToolUIs/write-ui';
import type {ToolRunActivitySummary, VicoToolkitDefinitionEntry} from './tool-summary';

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

/**
 * write 的 RunActivity 摘要 — 关键参数是目标文件路径。
 */
export function summarizeWrite(args: WriteArgs): ToolRunActivitySummary {
  return {
    icon: FilePlus,
    description: `Writing ${args.path}`,
  };
}

export const writeTool: VicoToolkitDefinitionEntry<WriteArgs, WriteResult> = {
  description: '在工作区创建新文件或覆盖已有文件，父目录不存在时自动创建。',
  parameters: writeSchema,
  render: WriteRenderer,
  summarize: summarizeWrite,
};
