/**
 * 包管理工具 UI — 渲染 package_install / package_run 两个工具。
 *
 * 两个工具均为 on-request（需审批），结果展示命令输出 + 退出码。
 */
import type {ToolCallMessagePartComponent} from '@assistant-ui/react';
import {Package, Play} from 'lucide-react';
import {ToolCard} from './tool-card';
import type {PackageInstallResult, PackageRunResult} from '../package.tool';

/** 工具名 → 中文标题 */
const TOOL_TITLE: Record<string, string> = {
  package_install: '安装依赖',
  package_run: '运行脚本',
};

/** 工具名 → 图标 */
const TOOL_ICON: Record<string, React.ElementType> = {
  package_install: Package,
  package_run: Play,
};

/** 命令输出 + 退出码视图（install / run 共用） */
function OutputView({output, exitCode, error}: {output: string; exitCode: number; error?: string}) {
  return (
    <div className="space-y-1.5">
      {output ? (
        <pre className="text-xs leading-relaxed font-mono overflow-x-auto whitespace-pre-wrap break-all bg-background/50 rounded p-2 max-h-48 overflow-y-auto">
          {output}
        </pre>
      ) : (
        <p className="text-xs text-muted-foreground">（无输出）</p>
      )}
      {error && <p className="text-xs text-destructive whitespace-pre-wrap">{error}</p>}
      <p className="text-[10px] text-muted-foreground">退出码：{exitCode}</p>
    </div>
  );
}

/** package_install 结果视图 */
function InstallView({result}: {result: PackageInstallResult}) {
  return (
    <div className="space-y-1.5">
      <p className="text-xs text-muted-foreground">管理器：{result.manager}</p>
      <OutputView output={result.output} exitCode={result.exitCode} error={result.error} />
    </div>
  );
}

/** package_run 结果视图 */
function RunView({result}: {result: PackageRunResult}) {
  return <OutputView output={result.output} exitCode={result.exitCode} error={result.error} />;
}

/**
 * 包管理工具渲染器 — 统一处理 install/run 两个工具。
 */
export const PackageToolRenderer: ToolCallMessagePartComponent = ({
  toolName,
  status,
  args,
  result,
  isError,
  approval,
  respondToApproval,
}) => {
  const title = TOOL_TITLE[toolName] ?? toolName;
  const Icon = TOOL_ICON[toolName] ?? Package;

  // 审批卡片补充描述
  const approvalDescription =
    toolName === 'package_install'
      ? `安装：${String((args as {packages?: string[]})?.packages?.join(', ') ?? '全部依赖')}`
      : `脚本：${String((args as {script?: string})?.script ?? '')}`;

  return (
    <ToolCard
      title={title}
      icon={Icon}
      status={status}
      result={result}
      isError={isError}
      approval={approval}
      respondToApproval={respondToApproval}
      approvalDescription={approvalDescription}
      renderResult={(r) => {
        if (toolName === 'package_install') return <InstallView result={r as PackageInstallResult} />;
        if (toolName === 'package_run') return <RunView result={r as PackageRunResult} />;
        return null;
      }}
    />
  );
};
