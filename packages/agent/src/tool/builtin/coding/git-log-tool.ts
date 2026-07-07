import {z} from 'zod';
import {createTool} from '../../create-tool.js';
import type {ToolCallContext} from '../../types.js';
import {resolveWorkspacePath} from '../workspace.js';
import {gitSafe} from './git-helpers.js';

// ── git_log ──

const gitLogParams = z.object({
  limit: z.number().int().min(1).max(100).default(20).describe('返回提交的最大数量'),
  path: z.string().optional().describe('限制到特定文件'),
});

const gitLogOutput = z.object({
  commits: z.array(z.object({
    hash: z.string(),
    message: z.string(),
    date: z.string(),
    author: z.string(),
  })),
  error: z.string().optional(),
});

async function executeGitLog(args: z.infer<typeof gitLogParams>, ctx: ToolCallContext) {
  const cwd = resolveWorkspacePath(ctx.session.workspace, '.');
  const cmdArgs = ['log', `-${args.limit}`, '--format=%H||%s||%ai||%an'];
  if (args.path) cmdArgs.push('--', args.path);

  const result = gitSafe(cwd, cmdArgs);
  if (result.error) {
    return { commits: [], error: result.error };
  }

  const commits = result.output.split('\n').filter(Boolean).map((line) => {
    const [hash, message, date, author] = line.split('||');
    return { hash, message, date, author };
  });

  return { commits };
}

export const gitLogTool = createTool({
  name: 'git_log',
  description: '显示 git 提交历史。返回指定数量的最近提交，包含 hash、提交信息、日期和作者。',
  inputSchema: gitLogParams,
  outputSchema: gitLogOutput,
  policy: 'auto',
  kind: 'readonly',
  tags: ['builtin', 'git', 'read'],
  execute: executeGitLog,
});
