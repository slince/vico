/**
 * 委托工具定义（前端）。
 *
 * 对应服务端 packages/core/src/tool/builtin/coding/delegate-tool.ts，
 * 参数 schema 与服务端 inputSchema/outputSchema 保持一致。
 * delegate 为 auto（无需审批），kind=delegate。
 */
import {z} from 'zod/v4';
import {Bot} from 'lucide-react';
import {DelegateRenderer} from './ToolUIs/delegate-ui';
import type {ToolRunActivitySummary, VicoToolkitDefinitionEntry} from './tool-summary';

const delegateSchema = z.object({
  task: z.string().describe('要委托给子 agent 完成的任务描述'),
  context: z.string().optional().describe('传递给子 agent 的上下文信息'),
});
const delegateOutputSchema = z.object({
  result: z.string(),
  steps: z.number().int().optional(),
  error: z.string().optional(),
});
export type DelegateArgs = z.infer<typeof delegateSchema>;
export type DelegateResult = z.infer<typeof delegateOutputSchema>;

/**
 * delegate 的 RunActivity 摘要 — 关键参数是委托任务描述。
 */
export function summarizeDelegate(args: DelegateArgs): ToolRunActivitySummary {
  return {
    icon: Bot,
    description: args.task,
  };
}

export const delegateTool: VicoToolkitDefinitionEntry<DelegateArgs, DelegateResult> = {
  description: '将子任务委托给子 agent 执行。子 agent 使用只读工具探索代码库并返回分析结果。',
  parameters: delegateSchema,
  render: DelegateRenderer,
  summarize: summarizeDelegate,
};
