/**
 * 包管理工具 UI — 渲染 package_install / package_run 两个工具。
 *
 * 两个工具均为 on-request（需审批），结果展示命令输出 + 退出码。
 */
import type {ToolCallMessagePartComponent} from '@assistant-ui/react';
import { useTranslation } from 'react-i18next';
import {Package, Play} from 'lucide-react';
import {ToolCard} from './tool-card';
import type {PackageInstallResult, PackageRunResult} from '../package.tool';

/** 工具名 → 图标 */
const TOOL_ICON: Record<string, React.ElementType> = {
  package_install: Package,
  package_run: Play,
};

/** 命令输出 + 退出码视图（install / run 共用） */
function OutputView({output, exitCode, error}: {output: string; exitCode: number; error?: string}) {
  const {t} = useTranslation('assistant');
  return (
    <div className="space-y-1.5">
      {output ? (
        <pre className="text-xs leading-relaxed font-mono overflow-x-auto whitespace-pre-wrap break-all bg-background/50 rounded p-2 max-h-48 overflow-y-auto">
          {output}
        </pre>
      ) : (
        <p className="text-xs text-muted-foreground">{t('tool.package.noOutput')}</p>
      )}
      {error && <p className="text-xs text-destructive whitespace-pre-wrap">{error}</p>}
      <p className="text-[10px] text-muted-foreground">{t('tool.package.exitCode', {code: exitCode})}</p>
    </div>
  );
}

/** package_install 结果视图 */
function InstallView({result}: {result: PackageInstallResult}) {
  const {t} = useTranslation('assistant');
  return (
    <div className="space-y-1.5">
      <p className="text-xs text-muted-foreground">{t('tool.package.manager', {manager: result.manager})}</p>
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
  const {t} = useTranslation('assistant');
  const title = t(`tool.package.title.${toolName}`, {defaultValue: toolName});
  const Icon = TOOL_ICON[toolName] ?? Package;

  // 审批卡片补充描述
  const approvalDescription =
    toolName === 'package_install'
      ? t('tool.package.install', {packages: String((args as {packages?: string[]})?.packages?.join(', ') ?? t('tool.package.allDeps'))})
      : t('tool.package.script', {script: String((args as {script?: string})?.script ?? '')});

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
