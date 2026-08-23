/**
 * Git 工具定义（前端）。
 *
 * 对应服务端 packages/core/src/tool/builtin/coding/git-*.tool.ts，
 * 参数 schema 与服务端 inputSchema/outputSchema 保持一致。
 * 6 个 git 工具共用一个渲染器 GitToolRenderer，内部按 toolName 分支。
 */
import {z} from 'zod/v4';
import {GitToolRenderer} from './ToolUIs/git-ui';

// ── git_status ──
const gitStatusSchema = z.object({
  path: z.string().optional().describe('相对于工作区根目录的路径'),
});
const gitStatusOutputSchema = z.object({
  status: z.string(),
  files: z.array(
    z.object({
      index: z.string(),
      worktree: z.string(),
      file: z.string(),
    }),
  ),
  branch: z.string(),
  error: z.string().optional(),
});
export type GitStatusArgs = z.infer<typeof gitStatusSchema>;
export type GitStatusResult = z.infer<typeof gitStatusOutputSchema>;

// ── git_diff ──
const gitDiffSchema = z.object({
  staged: z.boolean().optional().describe('是否显示暂存区变更'),
  path: z.string().optional().describe('限制到特定文件或目录'),
});
const gitDiffOutputSchema = z.object({
  diff: z.string(),
  error: z.string().optional(),
});
export type GitDiffArgs = z.infer<typeof gitDiffSchema>;
export type GitDiffResult = z.infer<typeof gitDiffOutputSchema>;

// ── git_log ──
const gitLogSchema = z.object({
  limit: z.number().int().min(1).max(100).default(20).describe('返回提交的最大数量'),
  path: z.string().optional().describe('限制到特定文件'),
});
const gitLogOutputSchema = z.object({
  commits: z.array(
    z.object({
      hash: z.string(),
      message: z.string(),
      date: z.string(),
      author: z.string(),
    }),
  ),
  error: z.string().optional(),
});
export type GitLogArgs = z.infer<typeof gitLogSchema>;
export type GitLogResult = z.infer<typeof gitLogOutputSchema>;

// ── git_branch ──
const gitBranchSchema = z.object({
  action: z.enum(['list', 'create']).default('list').describe('操作类型'),
  name: z.string().optional().describe('新分支名称（action=create 时必需）'),
});
const gitBranchOutputSchema = z.object({
  branches: z.array(z.string()),
  current: z.string(),
  error: z.string().optional(),
});
export type GitBranchArgs = z.infer<typeof gitBranchSchema>;
export type GitBranchResult = z.infer<typeof gitBranchOutputSchema>;

// ── git_commit ──
const gitCommitSchema = z.object({
  message: z.string().min(1).describe('提交信息'),
  files: z.array(z.string()).optional().describe('要暂存并提交的文件列表'),
});
const gitCommitOutputSchema = z.object({
  hash: z.string(),
  message: z.string(),
  error: z.string().optional(),
});
export type GitCommitArgs = z.infer<typeof gitCommitSchema>;
export type GitCommitResult = z.infer<typeof gitCommitOutputSchema>;

// ── git_checkout ──
const gitCheckoutSchema = z.object({
  target: z.string().describe('分支名称或文件路径'),
  isFile: z.boolean().optional().describe('target 是否为文件路径'),
});
const gitCheckoutOutputSchema = z.object({
  result: z.string(),
  error: z.string().optional(),
});
export type GitCheckoutArgs = z.infer<typeof gitCheckoutSchema>;
export type GitCheckoutResult = z.infer<typeof gitCheckoutOutputSchema>;

export const gitStatusTool = {
  description: '显示 git 工作区和暂存区状态。返回分支信息及变更文件列表（M=修改，A=新增，D=删除，?=未跟踪）。',
  parameters: gitStatusSchema,
  render: GitToolRenderer,
};

export const gitDiffTool = {
  description: '显示 git diff 变更。默认显示工作区未暂存的变更，staged 参数查看已暂存变更。',
  parameters: gitDiffSchema,
  render: GitToolRenderer,
  display: 'standalone' as const,
};

export const gitLogTool = {
  description: '显示 git 提交历史。返回指定数量的最近提交，包含 hash、提交信息、日期和作者。',
  parameters: gitLogSchema,
  render: GitToolRenderer,
};

export const gitBranchTool = {
  description: '列出或创建 git 分支。action=list 返回所有本地分支及当前分支标记，action=create 创建新分支。',
  parameters: gitBranchSchema,
  render: GitToolRenderer,
};

export const gitCommitTool = {
  description: '创建 git 提交。可选择性暂存指定文件后提交。提交信息为必填项。',
  parameters: gitCommitSchema,
  render: GitToolRenderer,
};

export const gitCheckoutTool = {
  description: '切换 git 分支或恢复文件。isFile=true 时恢复文件到上次提交的状态，否则切换到指定分支。',
  parameters: gitCheckoutSchema,
  render: GitToolRenderer,
};
