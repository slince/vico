/**
 * 命令执行工具 UI — 展示待审批命令并提供批准/拒绝按钮。
 *
 * 对应服务端 mastra_workspace_execute_command 工具。
 * 生命周期状态机（error/rejected/running/approval）统一由 ToolCard 承载，
 * 本渲染器只提供审批文案（命令）与完成态回执（命令已批准 + 命令内容）。
 */
import type {ToolCallMessagePartComponent} from '@assistant-ui/react';
import {useTranslation} from 'react-i18next';
import {Terminal, Check} from 'lucide-react';
import {ToolCard} from './tool-card';
import type {BashArgs} from '../bash.tool';

/** 完成态回执 — 命令已批准 + 命令内容 */
function ExecReceipt({command}: {command: string}) {
  const {t} = useTranslation('assistant');
  return (
    <div className="border rounded-lg p-3 my-2 bg-muted/30">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Check size={16} className="text-green-500" />
        <span>{t('tool.exec.approved')}</span>
      </div>
      <pre className="text-xs bg-background p-2 rounded border mt-1 overflow-x-auto whitespace-pre-wrap break-all max-h-32">
        {command}
      </pre>
    </div>
  );
}

export const ExecToolRenderer: ToolCallMessagePartComponent<BashArgs, unknown> = ({status, args, result, isError, approval, interrupt, resume, addResult, respondToApproval}) => {
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
      <ExecReceipt command={command} />
    </ToolCard>
  );
};
