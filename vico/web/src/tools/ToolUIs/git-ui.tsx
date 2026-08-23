/**
 * Git 工具 UI — 将 6 个 git 工具调用渲染为统一的卡片。
 *
 * 单个组件按 toolName 分支渲染不同结果：
 *   git_status   → 分支 + 变更文件列表（状态码着色）
 *   git_diff     → diff 文本（行级 +/- 着色）
 *   git_log      → 提交历史列表
 *   git_branch   → 分支列表（当前分支高亮）
 *   git_commit   → hash + message（需审批）
 *   git_checkout → 切换结果（需审批）
 *
 * 状态机与 weather-ui 一致：requires-action → running → complete / 拒绝 / 错误。
 */
import type {ToolCallMessagePartComponent} from '@assistant-ui/react';
import { useTranslation } from 'react-i18next';
import {GitBranch, GitCommit, FileDiff, History, Check} from 'lucide-react';
import {ToolCard} from './tool-card';
import type {
  GitStatusResult,
  GitDiffResult,
  GitLogResult,
  GitBranchResult,
  GitCommitResult,
  GitCheckoutResult,
} from '../git.tool';

/** git_status 状态码 → 展示颜色（tailwind 语义） */
const STATUS_CODE_COLOR: Record<string, string> = {
  M: 'text-amber-600 dark:text-amber-400',
  A: 'text-green-600 dark:text-green-400',
  D: 'text-red-600 dark:text-red-400',
  R: 'text-purple-600 dark:text-purple-400',
};

/** 工具名 → 图标 */
const TOOL_ICON: Record<string, React.ElementType> = {
  git_status: GitBranch,
  git_diff: FileDiff,
  git_log: History,
  git_branch: GitBranch,
  git_commit: GitCommit,
  git_checkout: GitBranch,
};

/** 单个文件的状态码拼接（暂存区 + 工作区，如 "M " / "??"） */
function statusCodeText(index: string, worktree: string): string {
  return `${index}${worktree}`.trim() || '  ';
}

/**
 * git_status 结果视图 — 分支名 + 变更文件列表。
 */
function StatusView({result}: {result: GitStatusResult}) {
  const {t} = useTranslation('assistant');
  // 状态码 → 展示文案（由 i18n 提供）
  const statusLabel: Record<string, string> = {
    M: t('tool.git.status.M'),
    A: t('tool.git.status.A'),
    D: t('tool.git.status.D'),
    R: t('tool.git.status.R'),
    '?': t('tool.git.status.untracked'),
  };
  return (
    <div className="space-y-2">
      {result.branch && (
        <div className="flex items-center gap-1.5 text-xs">
          <GitBranch size={12} className="text-muted-foreground" />
          <span className="font-mono text-muted-foreground">{result.branch}</span>
        </div>
      )}
      {result.files.length > 0 ? (
        <ul className="space-y-0.5">
          {result.files.map((f, i) => {
            const code = statusCodeText(f.index, f.worktree);
            return (
              <li key={i} className="flex items-center gap-2 text-xs">
                <span className="font-mono text-[10px] shrink-0 w-5 text-center">
                  <span className={STATUS_CODE_COLOR[f.index] || 'text-muted-foreground'}>
                    {f.index || ' '}
                  </span>
                  <span className={STATUS_CODE_COLOR[f.worktree] || 'text-muted-foreground'}>
                    {f.worktree || ' '}
                  </span>
                </span>
                <span className="font-mono truncate">{f.file}</span>
                <span className="text-[10px] text-muted-foreground ml-auto shrink-0">
                  {statusLabel[f.worktree] || statusLabel[f.index] || ''}
                </span>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-xs text-muted-foreground">{t('tool.git.clean')}</p>
      )}
    </div>
  );
}

/** diff 文本行级着色：+ 绿、- 红、@@ 蓝、其余默认 */
function DiffView({diff}: {diff: string}) {
  return (
    <pre className="text-[11px] leading-relaxed font-mono overflow-x-auto whitespace-pre-wrap break-all">
      {diff.split('\n').map((line, i) => {
        let cls = 'text-muted-foreground';
        if (line.startsWith('+++') || line.startsWith('---')) {
          cls = 'text-foreground font-medium';
        } else if (line.startsWith('@@')) {
          cls = 'text-blue-600 dark:text-blue-400';
        } else if (line.startsWith('+')) {
          cls = 'text-green-600 dark:text-green-400';
        } else if (line.startsWith('-')) {
          cls = 'text-red-600 dark:text-red-400';
        }
        return (
          <div key={i} className={cls}>
            {line || ' '}
          </div>
        );
      })}
    </pre>
  );
}

/** git_log 结果视图 — 提交历史列表 */
function LogView({result}: {result: GitLogResult}) {
  return (
    <ul className="space-y-2">
      {result.commits.map((c, i) => (
        <li key={i} className="text-xs">
          <div className="flex items-center gap-2">
            <span className="font-mono text-[11px] text-muted-foreground">{c.hash.slice(0, 7)}</span>
            <span className="font-medium truncate">{c.message}</span>
          </div>
          <div className="mt-0.5 flex items-center gap-2 text-[10px] text-muted-foreground pl-0">
            <span>{c.author}</span>
            <span>{c.date}</span>
          </div>
        </li>
      ))}
    </ul>
  );
}

/** git_branch 结果视图 — 分支列表，当前分支高亮 */
function BranchView({result}: {result: GitBranchResult}) {
  const {t} = useTranslation('assistant');
  return (
    <ul className="space-y-0.5">
      {result.branches.map((b, i) => {
        const isCurrent = b === result.current;
        return (
          <li key={i} className="flex items-center gap-2 text-xs">
            <GitBranch
              size={12}
              className={isCurrent ? 'text-green-600 dark:text-green-400' : 'text-muted-foreground'}
            />
            <span className={isCurrent ? 'font-mono font-medium text-foreground' : 'font-mono text-muted-foreground'}>
              {b}
            </span>
            {isCurrent && (
              <span className="text-[10px] text-green-600 dark:text-green-400 ml-auto">{t('tool.git.current')}</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** git_commit 结果视图 — hash + message */
function CommitView({result}: {result: GitCommitResult}) {
  return (
    <div className="space-y-1 text-xs">
      <div className="flex items-center gap-1.5">
        <Check size={14} className="text-green-500" />
        <span className="font-medium">{result.message}</span>
      </div>
      <p className="font-mono text-[11px] text-muted-foreground">{result.hash}</p>
    </div>
  );
}

/** git_checkout 结果视图 — 切换结果文本 */
function CheckoutView({result}: {result: GitCheckoutResult}) {
  return (
    <div className="flex items-center gap-1.5 text-xs">
      <Check size={14} className="text-green-500" />
      <span className="text-muted-foreground whitespace-pre-wrap">{result.result}</span>
    </div>
  );
}

/**
 * Git 工具渲染器 — 统一处理 6 个 git 工具的状态机与结果展示。
 *
 * @param toolName 工具名，用于分支渲染不同结果
 * @param status   工具调用状态（requires-action/running/complete/incomplete）
 * @param args     调用参数
 * @param result   执行结果
 */
export const GitToolRenderer: ToolCallMessagePartComponent = ({
  toolName,
  status,
  args,
  result,
  isError,
  approval,
  interrupt,
  resume,
  addResult,
  respondToApproval,
}) => {
  const {t} = useTranslation('assistant');
  const title = t(`tool.git.title.${toolName}`, {defaultValue: toolName});
  const Icon = TOOL_ICON[toolName] ?? GitBranch;

  // 审批卡片补充描述（仅 git_commit / git_checkout 会触发审批）
  const approvalDescription =
    toolName === 'git_commit'
      ? t('tool.git.commitMessage', {message: String((args as {message?: string})?.message ?? '')})
      : toolName === 'git_checkout'
        ? t('tool.git.target', {target: String((args as {target?: string})?.target ?? '')})
        : undefined;

  return (
    <ToolCard
      title={title}
      icon={Icon}
      status={status}
      result={result}
      isError={isError}
      approval={approval}
      interrupt={interrupt}
      resume={resume}
      addResult={addResult}
      respondToApproval={respondToApproval}
      approvalDescription={approvalDescription}
      renderResult={(r) => {
        switch (toolName) {
          case 'git_status':
            return <StatusView result={r as GitStatusResult} />;
          case 'git_diff':
            return <DiffView diff={(r as GitDiffResult).diff} />;
          case 'git_log':
            return <LogView result={r as GitLogResult} />;
          case 'git_branch':
            return <BranchView result={r as GitBranchResult} />;
          case 'git_commit':
            return <CommitView result={r as GitCommitResult} />;
          case 'git_checkout':
            return <CheckoutView result={r as GitCheckoutResult} />;
          default:
            return null;
        }
      }}
    />
  );
};
