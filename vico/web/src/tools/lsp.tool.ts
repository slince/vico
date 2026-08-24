/**
 * LSP 语言服务器工具定义（前端）。
 *
 * 对应服务端 packages/core/src/tool/builtin/coding/lsp-tool.ts，
 * 参数 schema 与服务端 inputSchema/outputSchema 保持一致。
 * lsp 为 auto 只读（无需审批）。
 */
import {z} from 'zod/v4';
import type {ToolkitDefinitionEntry} from '@assistant-ui/react';
import {LspRenderer} from './ToolUIs/lsp-ui';

const lspSchema = z.object({
  action: z.enum(['diagnostics', 'go_to_definition', 'completions', 'hover']).describe('LSP 操作类型'),
  filePath: z.string().describe('目标文件路径'),
  line: z.number().int().min(1).optional().describe('行号'),
  column: z.number().int().min(1).optional().describe('列号'),
});
const lspOutputSchema = z.object({
  result: z.string(),
  action: z.string(),
  supported: z.boolean(),
  error: z.string().optional(),
});
export type LspArgs = z.infer<typeof lspSchema>;
export type LspResult = z.infer<typeof lspOutputSchema>;

export const lspTool: ToolkitDefinitionEntry<LspArgs, LspResult> = {
  description: '语言服务器协议集成工具。支持诊断、跳转定义、代码补全和悬停信息。自动按文件扩展名匹配语言服务器。',
  parameters: lspSchema,
  render: LspRenderer,
};
