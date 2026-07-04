// src/tool/builtin/git-tools.ts
import {execSync} from 'node:child_process';
import {z} from 'zod';
import {createTool} from '../../create-tool.js';
import type {ToolCallContext} from '../../types.js';
import {resolveWorkspacePath} from '../workspace.js';

/** 在 workspace 目录执行 git 命令并返回输出 */
function git(cwd: string, args: string[]): string {
  return execSync(`git ${args.join(' ')}`, {
    cwd,
    encoding: 'utf-8',
    timeout: 30000,
    maxBuffer: 10 * 1024 * 1024,
  }).trim();
}

/** 安全执行 git 命令，失败时返回错误信息 */
function gitSafe(cwd: string, args: string[]): { output: string; error?: string } {
  try {
    return { output: git(cwd, args) };
  } catch (err: any) {
    return { output: '', error: err.stderr?.trim() || err.message };
  }
}

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
  const cwd = resolveWorkspacePath(ctx.session.workspace, args.path ?? '.');
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
  tags: ['builtin', 'git', 'read'],
  execute: executeGitStatus,
});

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
  const cwd = resolveWorkspacePath(ctx.session.workspace, '.');
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
  tags: ['builtin', 'git', 'read'],
  execute: executeGitDiff,
});

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
