/**
 * 命令执行工具 UI — 展示待审批命令并提供批准/拒绝按钮。
 *
 * 对应服务端 @vico/bash-tool 的 bash 工具。
 * 生命周期状态机（error/rejected/running/approval）统一由 ToolCard 承载，
 * 完成态（bare）展示工具标题、命令与执行结果（stdout / stderr / exitCode）。
 */
import type {ToolCallMessagePartComponent} from '@assistant-ui/react';
import {useTranslation} from 'react-i18next';
import {Terminal} from 'lucide-react';
import {ToolCard} from './tool-card';
import type {BashArgs, BashResult} from '../bash.tool';

/**
 * 完成态内容 — 工具标题 + 命令 + 执行结果。
 *
 * stdout 原样展示；stderr 以 destructive 色展示；exitCode 非 0 时提示退出码。
 */
function ExecReceipt({command, result}: {command: string; result?: BashResult}) {
  const {t} = useTranslation('assistant');

  const stdout = result?.stdout;
  const stderr = result?.stderr;
  const exitCode = result?.exitCode;

  return (
    <div className="border rounded-lg p-3 my-2 bg-muted/30 space-y-2">
      <div className="flex items-center gap-2 text-sm">
        <Terminal size={14} className="text-muted-foreground" />
        <span className="font-medium">{t('tool.exec.name')}</span>
      </div>

      <pre className="text-xs bg-background p-2 rounded border overflow-x-auto whitespace-pre-wrap break-all max-h-32">
        {command}
      </pre>

      {stdout != null && stdout !== '' && (
        <div>
          <p className="text-xs text-muted-foreground mb-1">{t('tool.exec.stdout')}</p>
          <pre className="text-xs bg-background p-2 rounded border overflow-x-auto whitespace-pre-wrap break-all max-h-64 overflow-y-auto">
            {stdout}
          </pre>
        </div>
      )}

      {stderr != null && stderr !== '' && (
        <div>
          <p className="text-xs text-muted-foreground mb-1">{t('tool.exec.stderr')}</p>
          <pre className="text-xs bg-background p-2 rounded border border-destructive/30 text-destructive overflow-x-auto whitespace-pre-wrap break-all max-h-64 overflow-y-auto">
            {stderr}
          </pre>
        </div>
      )}

      {exitCode != null && exitCode !== 0 && (
        <p className="text-xs text-muted-foreground">{t('tool.exec.exitCode', {code: exitCode})}</p>
      )}
    </div>
  );
}

export const ExecToolRenderer: ToolCallMessagePartComponent<BashArgs, BashResult> = ({status, args, result, isError, approval, interrupt, resume, addResult, respondToApproval}) => {
  const {t} = useTranslation('assistant');

  const command =
    typeof args.command === 'string'
      ? args.command
      : JSON.stringify(args || {});

  return (
    <ToolCard
      title={t('tool.exec.name')}
      icon={Terminal}
      status={status}
      result={result}
      isError={isError}
      approval={approval}
      interrupt={interrupt}
      resume={resume}
      addResult={addResult}
      respondToApproval={respondToApproval}
      approvalTitle={t('tool.exec.approvalTitle')}
      approvalCommand={command}
      runningLabel={t('tool.exec.executing')}
      rejectedLabel={t('tool.exec.rejected')}
      completeMode="bare"
    >
      <ExecReceipt command={command} result={result} />
    </ToolCard>
  );
};
