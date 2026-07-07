import {z} from 'zod';
import {createTool} from '../../create-tool.js';
import type {ToolCallContext} from '../../types.js';
import {resolveWorkspacePath} from '../workspace.js';
import {gitSafe} from './git-helpers.js';

// ── git_commit ──

const gitCommitParams = z.object({
  message: z.string().min(1).describe('提交信息'),
  files: z.array(z.string()).optional().describe('要暂存并提交的文件列表（不指定则提交所有已暂存变更）'),
});

const gitCommitOutput = z.object({
  hash: z.string(),
  message: z.string(),
  error: z.string().optional(),
});

async function executeGitCommit(args: z.infer<typeof gitCommitParams>, ctx: ToolCallContext) {
  const cwd = resolveWorkspacePath(ctx.session.workspace, '.');

  if (args.files && args.files.length > 0) {
    const addResult = gitSafe(cwd, ['add', '--', ...args.files]);
    if (addResult.error) return { hash: '', message: '', error: `git add 失败: ${addResult.error}` };
  }

  const commitResult = gitSafe(cwd, ['commit', '-m', args.message]);
  if (commitResult.error) {
    return { hash: '', message: '', error: commitResult.error };
  }

  const hashResult = gitSafe(cwd, ['rev-parse', 'HEAD']);
  return { hash: hashResult.output, message: args.message };
}

export const gitCommitTool = createTool({
  name: 'git_commit',
  description: '创建 git 提交。可选择性暂存指定文件后提交。提交信息为必填项。',
  inputSchema: gitCommitParams,
  outputSchema: gitCommitOutput,
  policy: 'on-request',
  kind: 'mutation',
  tags: ['builtin', 'git', 'mutation'],
  execute: executeGitCommit,
});
