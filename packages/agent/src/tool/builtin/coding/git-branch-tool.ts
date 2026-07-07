import {z} from 'zod';
import {createTool} from '../../create-tool.js';
import type {ToolCallContext} from '../../types.js';
import {resolveWorkspacePath} from '../workspace.js';
import {gitSafe} from './git-helpers.js';

// ── git_branch ──

const gitBranchParams = z.object({
  action: z.enum(['list', 'create']).default('list').describe('操作类型：list=列出分支，create=创建新分支'),
  name: z.string().optional().describe('新分支名称（action=create 时必需）'),
});

const gitBranchOutput = z.object({
  branches: z.array(z.string()),
  current: z.string(),
  error: z.string().optional(),
});

async function executeGitBranch(args: z.infer<typeof gitBranchParams>, ctx: ToolCallContext) {
  const cwd = resolveWorkspacePath(ctx.session.workspace, '.');

  if (args.action === 'create') {
    if (!args.name) return { branches: [], current: '', error: '创建分支需要 name 参数' };
    const result = gitSafe(cwd, ['branch', args.name]);
    if (result.error) return { branches: [], current: '', error: result.error };
  }

  const result = gitSafe(cwd, ['branch']);
  if (result.error) return { branches: [], current: '', error: result.error };

  let current = '';
  const branches = result.output.split('\n').filter(Boolean).map((line) => {
    if (line.startsWith('* ')) {
      current = line.slice(2);
      return current;
    }
    return line.trim();
  });

  return { branches, current };
}

export const gitBranchTool = createTool({
  name: 'git_branch',
  description: '列出或创建 git 分支。action=list 返回所有本地分支及当前分支标记，action=create 创建新分支。',
  inputSchema: gitBranchParams,
  outputSchema: gitBranchOutput,
  policy: 'auto',
  kind: 'readonly',
  tags: ['builtin', 'git', 'read'],
  execute: executeGitBranch,
});
