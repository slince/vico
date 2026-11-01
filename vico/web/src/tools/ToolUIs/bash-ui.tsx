/**
 * 命令执行工具 UI — 展示待审批命令并提供批准/拒绝按钮。
 *
 * 对应服务端 @vico/bash-tool 的 bash 工具。
 * 生命周期状态机（error/rejected/running/approval）统一由 ToolCard 承载；
 * 完成态用 card 模式：标题头展示工具名，折叠体展示命令与执行结果。
 */
import type {ToolCallMessagePartComponent} from '@assistant-ui/react';
import {useTranslation} from 'react-i18next';
import {useCopyToClipboard} from 'react-use';
import {Check, Copy, Terminal} from 'lucide-react';
import {ToolCard} from './tool-card';
import type {BashArgs, BashResult} from '../bash.tool';

/**
 * 完成态内容 — 命令 + 执行结果。
 *
 * stdout 原样展示；stderr 以 destructive 色展示；exitCode 非 0 时提示退出码。
 */
function ExecResult({command, result}: {command: string; result?: BashResult}) {
  const {t} = useTranslation('assistant');
  const [clipboard, copyToClipboard] = useCopyToClipboard();

  const stdout = result?.stdout;
  const stderr = result?.stderr;
  const exitCode = result?.exitCode;

  // 复制成功且复制值等于当前命令时，图标切换为勾
  const copied = clipboard.value === command && clipboard.error == null;

  return (
    <div className="space-y-2">
      <div className="text-xs divide-y divide-border/50">
        <div className="flex items-start gap-2 p-2 max-h-32 overflow-x-auto">
          <pre className="min-w-0 flex-1 text-right whitespace-pre-wrap break-all">
            {command}
          </pre>
          <button
            type="button"
            onClick={() => copyToClipboard(command)}
            aria-label={t('tool.exec.copy')}
            title={t('tool.exec.copy')}
            className="shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            {copied ? <Check size={12} className="text-emerald-500" /> : <Copy size={12} />}
          </button>
        </div>

        {stdout != null && stdout !== '' && (
          <pre className="p-2 overflow-x-auto whitespace-pre-wrap break-all max-h-64 overflow-y-auto">
            {stdout}
          </pre>
        )}

        {stderr != null && stderr !== '' && (
          <pre className="p-2 overflow-x-auto whitespace-pre-wrap break-all max-h-64 overflow-y-auto text-destructive">
            {stderr}
          </pre>
        )}
      </div>

      {exitCode != null && exitCode !== 0 && (
        <p className="text-xs text-muted-foreground">{t('tool.exec.exitCode', {code: exitCode})}</p>
      )}
    </div>
  );
}

export const BashToolRenderer: ToolCallMessagePartComponent<BashArgs, BashResult> = ({status, args, result, isError, approval, interrupt, resume, addResult, respondToApproval}) => {
  const {t} = useTranslation('assistant');

  const command =
    typeof args.command === 'string'
      ? args.command
      : JSON.stringify(args || {});

  // 命令意图说明（description 参数），展示在标题行与审批卡片的副标题
  const description = args?.description;

  return (
    <ToolCard
      title={t('tool.exec.name')}
      subtitle={description}
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
    >
      <ExecResult command={command} result={result} />
    </ToolCard>
  );
};
