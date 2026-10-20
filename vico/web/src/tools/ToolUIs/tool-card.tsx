/**
 * 通用工具卡片 — 工具渲染器的共享状态机骨架。
 *
 * 统一处理 error/incomplete → rejected → complete → requires-action → running 的流转，
 * 各工具只需提供标题、图标、审批文案和完成态内容（children），
 * 避免每个工具重复实现相同状态机。
 * 完成态默认折叠，标题行右侧提供展开/折叠按钮；completeMode="bare" 时整卡交给 children 自定义。
 * 审批态复用框架的 elements/ApprovalCard（HITL 决议 + i18n 文案在此落地）。
 */
import {useState, type ElementType, type ReactNode} from 'react';
import {useTranslation} from 'react-i18next';
import {Loader2, Wrench, X, ChevronDown} from 'lucide-react';
import type {ToolApprovalResponse, ToolCallMessagePart, ToolCallMessagePartStatus} from '@assistant-ui/react';
import {ApprovalCard} from '@/components/assistant-ui/elements/approval-card';
import {cn} from '@/lib/utils';

export interface ToolCardProps {
  /** 卡片标题（工具中文名） */
  title: string;
  /** 标题右侧补充信息（如文件/目录路径），mono 字体展示 */
  subtitle?: string;
  /** 标题图标 */
  icon?: ElementType;
  /** 工具调用状态 */
  status?: ToolCallMessagePartStatus;
  /** 执行结果（错误态下为 { error: string }） */
  result?: unknown;
  /** 是否出错 */
  isError?: boolean;
  /** 服务端审批门禁状态 */
  approval?: ToolCallMessagePart["approval"];
  /** 前端 human 工具的中断请求 */
  interrupt?: ToolCallMessagePart["interrupt"];
  /** 恢复 human 工具（interrupt）执行 */
  resume?: (payload: unknown) => void;
  /** 直接写入工具结果。result 类型随各工具 TResult 泛型而异，any 与 @assistant-ui/react 内部一致 */
  addResult?: (result: any) => void;
  /** 审批回调 */
  respondToApproval?: (response: ToolApprovalResponse) => void;
  /** 审批标题，默认 "{title} 需要确认" */
  approvalTitle?: string;
  /** 审批卡片补充描述（requires-action 时展示） */
  approvalDescription?: string;
  /** 审批卡片 command 字段（mono 展示，如 Shell 命令） */
  approvalCommand?: string;
  /** 错误态文案，默认 "{title} 失败" */
  errorLabel?: string;
  /** 运行态文案，默认 "{title} 执行中..." */
  runningLabel?: string;
  /** 拒绝态文案，默认 "{title} 已被拒绝" */
  rejectedLabel?: string;
  /** 完成态渲染模式：card=标题头+折叠体（默认）；bare=整卡交给 children 自定义 */
  completeMode?: 'card' | 'bare';
  /** 完成态内容（card 模式为折叠体，bare 模式为整卡） */
  children?: ReactNode;
}

/**
 * 通用工具卡片。
 *
 * 状态机（优先级从高到低）：
 * - isError / incomplete → destructive 错误态（isError 时 result 可能携带 { error: ... }，须优先于完成态判断）
 * - approval 被拒绝 → destructive 拒绝态
 * - complete 且有 result → 卡片（header + 可折叠 children）或 bare 自定义整卡
 * - requires-action → 框架 ApprovalCard 审批
 * - running → 加载占位
 */
export function ToolCard({
  title,
  subtitle,
  icon: Icon = Wrench,
  status,
  result,
  isError,
  approval,
  interrupt,
  resume,
  addResult,
  respondToApproval,
  approvalTitle,
  approvalDescription,
  approvalCommand,
  errorLabel,
  runningLabel,
  rejectedLabel,
  completeMode = 'card',
  children,
}: ToolCardProps) {
  const {t} = useTranslation('assistant');
  // 完成态结果折叠状态（默认折叠，可手动展开）
  const [open, setOpen] = useState(false);
  // 审批是否已提交（防重复点击）
  const [submitted, setSubmitted] = useState(false);

  // 错误/未完成优先：isError 时 result 可能携带 { error: ... }，不能按完成态渲染
  if (isError || status?.type === 'incomplete') {
    // isError 时展示 result.error；incomplete（取消）通常无错误详情
    const errorMessage = isError
      ? (result as { error?: string } | undefined)?.error
      : undefined;
    return (
      <div className="border border-destructive/30 rounded-lg p-3 my-2 bg-destructive/5">
        <div className="flex items-center gap-2">
          <X size={16} className="text-destructive" />
          <span className="text-sm text-destructive">
            {errorLabel ?? t('tool.card.failed', {name: title})}
          </span>
        </div>
        {errorMessage && (
          <p className="mt-1.5 font-mono text-xs text-destructive/80 break-all whitespace-pre-wrap">
            {errorMessage}
          </p>
        )}
      </div>
    );
  }

  // 审批已裁决（被拒绝或已批准且有结果）
  if (approval?.approved !== undefined || result !== undefined) {
    const isApproved = approval?.approved ?? true;

    if (!isApproved) {
      return (
        <div className="border border-destructive/30 rounded-lg p-3 my-2 bg-destructive/5">
          <div className="flex items-center gap-2">
            <X size={16} className="text-destructive" />
            <span className="text-sm text-destructive">
              {rejectedLabel ?? t('tool.card.rejected', {name: title})}
            </span>
          </div>
        </div>
      );
    }

    if (status?.type === 'complete' && result !== undefined) {
      // bare：完成态整卡交给工具自定义（如天气渐变大卡、检索结果列表）
      if (completeMode === 'bare') {
        return <>{children}</>;
      }

      return (
        <div className="border rounded-lg p-3 my-2 bg-muted/30">
          <div className="flex items-center gap-2">
            <Icon size={14} className="text-muted-foreground" />
            <span className="text-sm font-medium">{title}</span>
            {subtitle && (
              <span className="font-mono text-xs text-muted-foreground truncate max-w-[50%]">
                {subtitle}
              </span>
            )}
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              aria-label={open ? t('tool.card.collapse') : t('tool.card.expand')}
              className="ml-auto p-1 rounded hover:bg-muted transition-colors"
            >
              <ChevronDown
                size={16}
                className={cn(
                  'text-muted-foreground transition-transform duration-200',
                  open ? 'rotate-0' : '-rotate-90',
                )}
              />
            </button>
          </div>
          {open && (
            <div className="mt-2 pt-2 border-t border-border/50">
              {children}
            </div>
          )}
        </div>
      );
    }
  }

  // 需要审批
  if (status?.type === 'requires-action') {
    // 审批已按 resolution 关闭（取消/过期）但 approved 未落定 → 不再渲染审批按钮
    if (
      approval != null &&
      (approval.approved !== undefined || approval.resolution !== undefined)
    ) {
      return null;
    }

    const respond = (approved: boolean) => {
      if (submitted) return;
      // 三种 HITL 机制分别处理：服务端 approval 门禁 / 前端 human 中断 / 直接写结果兜底
      if (
        approval != null &&
        approval.approved === undefined &&
        approval.resolution === undefined &&
        respondToApproval
      ) {
        respondToApproval({approved});
      } else if (interrupt) {
        resume?.({approved});
      } else {
        addResult?.(approved ? t('tool.approvedResult') : t('tool.deniedResult'));
      }
      setSubmitted(true);
    };

    return (
      <ApprovalCard
        state="request"
        title={approvalTitle ?? t('tool.approvalRequired', {name: title})}
        subtitle={subtitle ?? ''}
        description={approvalDescription}
        command={approvalCommand}
        icon={<Icon className="size-4" />}
        onAllowOnce={() => respond(true)}
        onDeny={() => respond(false)}
        allowOnceLabel={t('tool.allowOnce')}
        denyLabel={t('tool.denyOnce')}
        className="my-2"
      />
    );
  }

  // 执行中
  if (status?.type === 'running') {
    return (
      <div className="border rounded-lg p-3 my-2 bg-muted/30 animate-pulse">
        <div className="flex items-center gap-2">
          <Loader2 size={14} className="text-muted-foreground animate-spin" />
          <span className="text-sm text-muted-foreground">
            {runningLabel ?? t('tool.card.running', {name: title})}
          </span>
        </div>
      </div>
    );
  }

  return null;
}
