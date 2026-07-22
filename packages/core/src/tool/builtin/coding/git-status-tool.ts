import {z} from 'zod';
import {createTool} from '../../create-tool.js';
import type {ToolCallContext} from '../../types.js';
import {resolveWorkspacePath} from '../workspace.js';
import {gitSafe} from './git-helpers.js';

// ── git_status ──

const gitStatusParams = z.object({
  path: z.string().optional().describe('相对于工作区根目录的路径'),
});

const gitStatusOutput = z.object({
  status: z.string(),
  files: z.array(z.object({
    index: z.string().describe('暂存区状态码'),
    worktree: z.string().describe('工作区状态码'),
    file: z.string(),
  })),
  branch: z.string(),
  error: z.string().optional(),
});

async function executeGitStatus(args: z.infer<typeof gitStatusParams>, ctx: ToolCallContext) {
  const cwd = resolveWorkspacePath(ctx.session.workspace!, args.path ?? '.');
  const result = gitSafe(cwd, ['status', '--porcelain=v1', '--branch']);

  if (result.error) {
    return { status: '', files: [], branch: '', error: result.error };
  }

  const lines = result.output.split('\n').filter(Boolean);
  let branch = '';
  const files: Array<{ index: string; worktree: string; file: string }> = [];

  for (const line of lines) {
    if (line.startsWith('## ')) {
      branch = line.slice(3);
    } else if (line.length >= 3) {
      files.push({
        index: line[0],
        worktree: line[1],
        file: line.slice(3),
      });
    }
  }

  return { status: result.output, files, branch };
}

export const gitStatusTool = createTool({
  name: 'git_status',
  description: '显示 git 工作区和暂存区状态。返回分支信息及变更文件列表，包含暂存区和工作区的状态码（M=修改，A=新增，D=删除，?=未跟踪）。',
  inputSchema: gitStatusParams,
  outputSchema: gitStatusOutput,
  policy: 'auto',
  kind: 'readonly',
  tags: ['builtin', 'git', 'read', 'requires-workspace'],
  execute: executeGitStatus,
});
