import {z} from 'zod';
import {createTool} from '../../create-tool.js';
import type {ToolCallContext} from '../../types.js';
import {resolveWorkspacePath} from '../workspace.js';
import {gitSafe} from './git-helpers.js';

// ── git_checkout ──

const gitCheckoutParams = z.object({
  target: z.string().describe('分支名称或文件路径'),
  isFile: z.boolean().optional().describe('target 是否为文件路径（用于恢复文件）'),
});

const gitCheckoutOutput = z.object({
  result: z.string(),
  error: z.string().optional(),
});

async function executeGitCheckout(args: z.infer<typeof gitCheckoutParams>, ctx: ToolCallContext) {
  const cwd = resolveWorkspacePath(ctx.session.workspace, '.');

  const cmdArgs = args.isFile ? ['checkout', '--', args.target] : ['checkout', args.target];
  const result = gitSafe(cwd, cmdArgs);

  if (result.error) {
    return { result: '', error: result.error };
  }
  return { result: result.output || `已切换到 ${args.target}` };
}

export const gitCheckoutTool = createTool({
  name: 'git_checkout',
  description: '切换 git 分支或恢复文件。isFile=true 时恢复文件到上次提交的状态，否则切换到指定分支。',
  inputSchema: gitCheckoutParams,
  outputSchema: gitCheckoutOutput,
  policy: 'on-request',
  kind: 'file_change',
  tags: ['builtin', 'git', 'mutation'],
  execute: executeGitCheckout,
});
