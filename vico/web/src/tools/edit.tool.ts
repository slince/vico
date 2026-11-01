/**
 * 文件编辑工具定义（前端）。
 *
 * 对应服务端 packages/fs-tool/src/edit-tool.ts，
 * 参数 schema 与服务端 inputSchema/outputSchema 保持一致。
 */
import {z} from 'zod/v4';
import {FilePen} from 'lucide-react';
import {EditRenderer} from './ToolUIs/edit-ui';
import type {ToolRunActivitySummary, VicoToolkitDefinitionEntry} from './tool-summary';

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

/**
 * edit 的 RunActivity 摘要 — 关键参数是被编辑的文件路径。
 */
export function summarizeEdit(args: EditArgs): ToolRunActivitySummary {
  return {
    icon: FilePen,
    description: `Editing ${args.path}`,
  };
}

export const editTool: VicoToolkitDefinitionEntry<EditArgs, EditResult> = {
  description: '通过字面量文本替换编辑文件，一次一处或 replaceAll 全替换。返回 unified diff。',
  parameters: editSchema,
  render: EditRenderer,
  summarize: summarizeEdit,
};
