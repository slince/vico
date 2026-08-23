/**
 * 命令执行工具 UI — 展示待审批命令并提供批准/拒绝按钮。
 *
 * 对应服务端 mastra_workspace_execute_command 工具。
 * status === 'requires-action' 时展示审批卡片；
 * 用户通过 respondToApproval 提交决定。
 */
import type { ToolCallMessagePartComponent } from '@assistant-ui/react';
import { useTranslation } from 'react-i18next';
import { Terminal, Check, X } from 'lucide-react';
import { ToolApprovalCard } from '@/components/assistant-ui/tool-approval-card';
import type { BashArgs } from '../bash.tool';

export const ExecToolRenderer: ToolCallMessagePartComponent<BashArgs, unknown> = ({ status, args, respondToApproval, approval, result }) => {
  const { t } = useTranslation('assistant');

  const command =
    typeof args.command === 'string'
      ? args.command
      : JSON.stringify(args || {});

  // 已解决：展示最终状态
  if (approval?.approved !== undefined || result !== undefined) {
    const isApproved = approval?.approved ?? true;
    return (
      <div className="border rounded-lg p-3 my-2 bg-muted/30">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          {isApproved ? (
            <Check size={16} className="text-green-500" />
          ) : (
            <X size={16} className="text-destructive" />
          )}
          <span>{isApproved ? t('tool.exec.approved') : t('tool.exec.rejected')}</span>
        </div>
        <pre className="text-xs bg-background p-2 rounded border mt-1 overflow-x-auto whitespace-pre-wrap break-all max-h-32">
          {command}
        </pre>
      </div>
    );
  }

  // 需要审批
  if (status.type === 'requires-action') {
    return (
      <ToolApprovalCard
        toolName={t('tool.exec.name')}
        title={t('tool.exec.approvalTitle')}
        icon={Terminal}
        respondToApproval={respondToApproval}
      >
        <pre className="text-xs bg-background p-2 rounded border overflow-x-auto whitespace-pre-wrap break-all max-h-32">
          {command}
        </pre>
      </ToolApprovalCard>
    );
  }

  // 执行中
  if (status.type === 'running') {
    return (
      <div className="border rounded-lg p-3 my-2 bg-muted/30 animate-pulse">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Terminal size={16} />
          <span>{t('tool.exec.executing')}</span>
        </div>
        <pre className="text-xs bg-background p-2 rounded border mt-1 overflow-x-auto whitespace-pre-wrap break-all max-h-32">
          {command}
        </pre>
      </div>
    );
  }

  // 其他状态用默认渲染
  return null;
};
