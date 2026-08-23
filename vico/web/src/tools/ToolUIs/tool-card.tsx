/**
 * 通用工具卡片 — 分组工具渲染器的共享状态机骨架。
 *
 * 统一处理 requires-action → running → complete / 拒绝 / 错误的 5 态流转，
 * 各分组组件只需提供标题、图标、审批描述和完成态内容（renderResult），
 * 避免每个分组重复实现相同状态机。
 */
import type {ReactNode} from 'react';
import {Loader2, Wrench, X} from 'lucide-react';
import type {ToolApprovalResponse, ToolCallMessagePartStatus} from '@assistant-ui/react';
import {ToolApprovalCard} from '@/components/assistant-ui/tool-approval-card';

export interface ToolCardProps {
  /** 卡片标题（工具中文名） */
  title: string;
  /** 标题图标 */
  icon?: React.ElementType;
  /** 工具调用状态 */
  status?: ToolCallMessagePartStatus;
  /** 执行结果 */
  result?: unknown;
  /** 是否出错 */
  isError?: boolean;
  /** 审批状态 */
  approval?: {approved?: boolean};
  /** 审批回调 */
  respondToApproval?: (response: ToolApprovalResponse) => void;
  /** 审批卡片补充描述（requires-action 时展示） */
  approvalDescription?: string;
  /** 完成态内容渲染（仅在 complete 且 result 存在时调用） */
  renderResult: (result: unknown) => ReactNode;
}

/**
 * 通用工具卡片。
 *
 * 状态机：
 * - approval 被拒绝 → destructive 拒绝态
 * - complete 且有 result → 卡片（header + renderResult）
 * - requires-action → ToolApprovalCard 审批
 * - running → 加载占位
 * - isError / incomplete → destructive 错误态
 */
export function ToolCard({
  title,
  icon: Icon = Wrench,
  status,
  result,
  isError,
  approval,
  respondToApproval,
  approvalDescription,
  renderResult,
}: ToolCardProps) {
  // 审批已裁决（被拒绝或已批准且有结果）
  if (approval?.approved !== undefined || result !== undefined) {
    const isApproved = approval?.approved ?? true;

    if (!isApproved) {
      return (
        <div className="border border-destructive/30 rounded-lg p-3 my-2 bg-destructive/5">
          <div className="flex items-center gap-2">
            <X size={16} className="text-destructive" />
            <span className="text-sm text-destructive">{title}已被拒绝</span>
          </div>
        </div>
      );
    }

    if (status?.type === 'complete' && result !== undefined) {
      return (
        <div className="border rounded-lg p-3 my-2 bg-muted/30">
          <div className="flex items-center gap-2 mb-2 pb-2 border-b border-border/50">
            <Icon size={14} className="text-muted-foreground" />
            <span className="text-sm font-medium">{title}</span>
          </div>
          {renderResult(result)}
        </div>
      );
    }
  }

  // 需要审批
  if (status?.type === 'requires-action') {
    return (
      <ToolApprovalCard
        toolName={title}
        title={`${title}需要确认`}
        description={approvalDescription}
        icon={Icon}
        respondToApproval={respondToApproval}
      />
    );
  }

  // 执行中
  if (status?.type === 'running') {
    return (
      <div className="border rounded-lg p-3 my-2 bg-muted/30 animate-pulse">
        <div className="flex items-center gap-2">
          <Loader2 size={14} className="text-muted-foreground animate-spin" />
          <span className="text-sm text-muted-foreground">{title}执行中...</span>
        </div>
      </div>
    );
  }

  // 错误
  if (isError || status?.type === 'incomplete') {
    return (
      <div className="border border-destructive/30 rounded-lg p-3 my-2 bg-destructive/5">
        <div className="flex items-center gap-2">
          <X size={16} className="text-destructive" />
          <span className="text-sm text-destructive">{title}失败</span>
        </div>
      </div>
    );
  }

  return null;
}
