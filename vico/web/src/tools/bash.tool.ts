/**
 * 命令执行工具定义（Mastra workspace execute_command built-in）。
 *
 * 需用户审批（human 类型），在沙箱中执行 Shell 命令。
 * 参数定义参考 docs/mastra/09-builtin-tools-catalog.md
 */
import {z} from 'zod/v4';
import {ExecToolRenderer} from './ToolUIs/exec-ui';

const bashSchema = z.object({
  command: z.string().describe('要执行的 Shell 命令'),
  timeout: z.number().optional().describe('超时时间（毫秒）'),
  cwd: z.string().optional().describe('工作目录'),
  tail: z.number().optional().describe('仅返回最后 N 行输出'),
  background: z.boolean().optional().describe('是否后台运行'),
});

export type BashArgs = z.infer<typeof bashSchema>;

export const bashTool = {
  type: 'human' as const,
  description: '在沙箱中执行 Shell 命令，支持管道/重定向/后台运行',
  parameters: bashSchema,
  render: ExecToolRenderer,
};
