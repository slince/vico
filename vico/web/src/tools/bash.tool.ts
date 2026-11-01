/**
 * 命令执行工具定义（前端）。
 *
 * 对应服务端 @vico/bash-tool（packages/bash-tool/src/bash-tool.ts）。
 * bash 为服务端工具：执行在服务端，审批由服务端 approvalMode 决定（workspace
 * 模式下命令无法静态界定操作范围，因此 paused 需审批）；前端仅提供 render 与摘要。
 */
import {z} from 'zod/v4';
import {Terminal} from 'lucide-react';
import {BashToolRenderer} from './ToolUIs/bash-ui';
import type {ToolRunActivitySummary, VicoToolkitDefinitionEntry} from './tool-summary';

const bashSchema = z.object({
  command: z.string().describe('要执行的 Shell 命令'),
  description: z.string().describe('调用该命令的意图说明'),
  timeout: z.number().optional().describe('超时时间（毫秒）'),
  cwd: z.string().optional().describe('工作目录'),
  tail: z.number().optional().describe('仅返回最后 N 行输出'),
  background: z.boolean().optional().describe('是否后台运行'),
});

export type BashArgs = z.infer<typeof bashSchema>;

/** bash 工具的结构化输出（与服务端 @vico/bash-tool 的 bashOutput 对齐） */
const bashOutputSchema = z.object({
  stdout: z.string(),
  stderr: z.string(),
  exitCode: z.number().int().nullable(),
});
export type BashResult = z.infer<typeof bashOutputSchema>;

/**
 * bash 的 RunActivity 摘要 — 展示要执行的 Shell 命令。
 */
export function summarizeBash(args: BashArgs): ToolRunActivitySummary {
  return {
    icon: Terminal,
    description: `Execute shell "${args.command}"`,
  };
}

export const bashTool: VicoToolkitDefinitionEntry<BashArgs, BashResult> = {
  description: '在沙箱中执行 Shell 命令，支持管道/重定向/后台运行',
  parameters: bashSchema,
  render: BashToolRenderer,
  summarize: summarizeBash,
};
