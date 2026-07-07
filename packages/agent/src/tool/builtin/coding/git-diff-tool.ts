import {z} from 'zod';
import {createTool} from '../../create-tool.js';
import type {ToolCallContext} from '../../types.js';
import {resolveWorkspacePath} from '../workspace.js';
import {gitSafe} from './git-helpers.js';

// ── git_diff ──

const gitDiffParams = z.object({
  staged: z.boolean().optional().describe('是否显示暂存区变更（默认显示工作区变更）'),
  path: z.string().optional().describe('限制到特定文件或目录'),
});

const gitDiffOutput = z.object({
  diff: z.string(),
  error: z.string().optional(),
});

async function executeGitDiff(args: z.infer<typeof gitDiffParams>, ctx: ToolCallContext) {
  const cwd = resolveWorkspacePath(ctx.session.workspace!, '.');
  const cmdArgs = ['diff', '--unified=3'];
  if (args.staged) cmdArgs.push('--cached');
  if (args.path) cmdArgs.push('--', args.path);

  const result = gitSafe(cwd, cmdArgs);
  return { diff: result.output || '(无变更)', error: result.error };
}

export const gitDiffTool = createTool({
  name: 'git_diff',
  description: '显示 git diff 变更。默认显示工作区未暂存的变更，使用 staged 参数查看已暂存的变更。',
  inputSchema: gitDiffParams,
  outputSchema: gitDiffOutput,
  policy: 'auto',
  kind: 'readonly',
  tags: ['builtin', 'git', 'read', 'requires-workspace'],
  execute: executeGitDiff,
});
