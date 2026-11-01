/**
 * 通用工具卡片 — 工具渲染器的共享状态机骨架。
 *
 * 统一处理 error/incomplete → rejected → complete → requires-action → running 的流转，
 * 各工具只需提供标题、图标、审批文案和完成态内容（children）。
 * 错误/拒绝/执行中/完成态共用 ToolCardShell 统一外壳，通过 tone 字段区分配色，
 * header 统一保留 icon + 标题 + subtitle，避免每个状态各写一套结构。
 * 完成态默认折叠，标题行提供展开/折叠；completeMode="bare" 时整卡交给 children 自定义。
 * 审批态复用框架的 elements/ApprovalCard（HITL 决议 + i18n 文案在此落地）。
 */
import {type ElementType, type ReactNode, useState} from 'react';
import {useTranslation} from 'react-i18next';
import {ChevronDown, Loader2, Wrench, X} from 'lucide-react';
import type {ToolApprovalResponse, ToolCallMessagePart, ToolCallMessagePartStatus} from '@assistant-ui/react';
import {ApprovalCard} from '@/components/assistant-ui/elements/approval-card';
import {cn} from '@/lib/utils';

/**
 * 会话级放行信号 — 与服务端 @vico/types 的 SESSION_SCOPE_REASON 保持一致。
 * web 无法引入后端包，故此处重复字面量；改动须两边同步。
 */
const SESSION_SCOPE_REASON = '__vico_scope_session__';

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
 * 状态色调 — 统一外壳按 tone 渲染容器边框/背景与标题配色。
 */
const TONE_STYLES = {
  default: {
    frame: '',
    title: 'text-foreground',
  },
  muted: {
    frame: 'bg-muted/30 animate-pulse',
    title: 'text-muted-foreground',
  },
  destructive: {
    frame: 'bg-destructive/5',
    title: 'text-destructive',
  },
} as const;

type ToolCardTone = keyof typeof TONE_STYLES;

/**
 * 统一卡片外壳 — 各状态共用的 header 骨架（icon + 标题 + subtitle + trailing）。
 *
 * tone 决定容器与标题配色；onHeaderClick 提供时 header 整行可点击（完成态折叠），
 * 错误/拒绝/执行中通过 tone 与 trailing 图标呈现差异，避免每状态各写一套结构。
 */
function ToolCardShell({
  tone,
  icon: Icon,
  title,
  subtitle,
  trailing,
  onHeaderClick,
  headerAriaExpanded,
  headerAriaLabel,
  children,
}: {
  /** 状态色调 */
  tone: ToolCardTone;
  /** 工具图标 */
  icon: ElementType;
  /** 标题文案 */
  title: string;
  /** 补充信息（路径/意图等） */
  subtitle?: string;
  /** 右侧状态元素（展开箭头/加载/关闭图标） */
  trailing?: ReactNode;
  /** 提供则 header 整行可点击 */
  onHeaderClick?: () => void;
  /** 点击 header 的展开状态 */
  headerAriaExpanded?: boolean;
  /** 点击 header 的无障碍标签 */
  headerAriaLabel?: string;
  /** header 下方内容（错误详情/折叠体） */
  children?: ReactNode;
}) {
  const style = TONE_STYLES[tone];

  return (
    <div className={cn('rounded-lg p-3 my-2', style.frame)}>
      <div
        onClick={onHeaderClick}
        role={onHeaderClick ? 'button' : undefined}
        tabIndex={onHeaderClick ? 0 : undefined}
        aria-expanded={onHeaderClick ? headerAriaExpanded : undefined}
        aria-label={onHeaderClick ? headerAriaLabel : undefined}
        onKeyDown={
          onHeaderClick
            ? (e) => {
                // 让整行可点击也支持键盘触发（Enter/Space），对齐原生 button 语义
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onHeaderClick();
                }
              }
            : undefined
        }
        className={cn(
          'flex w-full items-center gap-2 text-left',
          onHeaderClick && 'cursor-pointer',
        )}
      >
        <Icon size={14} className="shrink-0 text-muted-foreground" />
        <span className={cn('text-sm font-medium truncate', style.title)}>
          {title}
        </span>
        {subtitle && (
          <span className="font-mono text-xs text-muted-foreground truncate max-w-[50%]">
            {subtitle}
          </span>
        )}
        {trailing && <span className="ml-auto shrink-0">{trailing}</span>}
      </div>
      {children}
    </div>
  );
}

/**
 * 通用工具卡片。
 *
 * 状态机（优先级从高到低）：
 * - isError / incomplete → destructive 错误态（isError 时 result 可能携带 { error: ... }，须优先于完成态判断）
 * - approval 被拒绝 → destructive 拒绝态
 * - complete 且有 result → 卡片（header + 可折叠 children）或 bare 自定义整卡
 * - requires-action → 框架 ApprovalCard 审批
 * - running → muted 加载态
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
      <ToolCardShell
        tone="destructive"
        icon={Icon}
        title={errorLabel ?? t('tool.card.failed', {name: title})}
        subtitle={subtitle}
        trailing={<X size={16} className="text-destructive" />}
      >
        {errorMessage && (
          <p className="mt-1.5 font-mono text-xs text-destructive/80 break-all whitespace-pre-wrap">
            {errorMessage}
          </p>
        )}
      </ToolCardShell>
    );
  }

  // 审批已裁决（被拒绝或已批准且有结果）
  if (approval?.approved !== undefined || result !== undefined) {
    const isApproved = approval?.approved ?? true;

    if (!isApproved) {
      return (
        <ToolCardShell
          tone="destructive"
          icon={Icon}
          title={rejectedLabel ?? t('tool.card.rejected', {name: title})}
          subtitle={subtitle}
          trailing={<X size={16} className="text-destructive" />}
        />
      );
    }

    if (status?.type === 'complete' && result !== undefined) {
      // bare：完成态整卡交给工具自定义（如天气渐变大卡、检索结果列表）
      if (completeMode === 'bare') {
        return <>{children}</>;
      }

      return (
        <ToolCardShell
          tone="default"
          icon={Icon}
          title={title}
          subtitle={subtitle}
          onHeaderClick={() => setOpen((v) => !v)}
          headerAriaExpanded={open}
          headerAriaLabel={open ? t('tool.card.collapse') : t('tool.card.expand')}
          trailing={
            <ChevronDown
              size={16}
              className={cn(
                'text-muted-foreground transition-transform duration-200',
                open ? 'rotate-0' : '-rotate-90',
              )}
            />
          }
        >
          {open && <div className="mt-2 rounded-lg bg-muted/30 p-2">{children}</div>}
        </ToolCardShell>
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

    const respond = (approved: boolean, scope: 'turn' | 'session' = 'turn') => {
      if (submitted) return;
      // 三种 HITL 机制分别处理：服务端 approval 门禁 / 前端 human 中断 / 直接写结果兜底
      if (
        approval != null &&
        approval.approved === undefined &&
        approval.resolution === undefined &&
        respondToApproval
      ) {
        // 会话级放行经 reason 字段 in-band 传递（AI SDK 只透传 approved/reason）
        respondToApproval({
          approved,
          ...(scope === 'session' ? { reason: SESSION_SCOPE_REASON } : {}),
        });
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
        onAlwaysAllow={() => respond(true, 'session')}
        onDeny={() => respond(false)}
        allowOnceLabel={t('tool.allowOnce')}
        alwaysAllowLabel={t('tool.allowAlways')}
        denyLabel={t('tool.denyOnce')}
        className="my-2"
      />
    );
  }

  // 执行中
  if (status?.type === 'running') {
    return (
      <ToolCardShell
        tone="muted"
        icon={Icon}
        title={runningLabel ?? t('tool.card.running', {name: title})}
        subtitle={subtitle}
        trailing={<Loader2 size={14} className="text-muted-foreground animate-spin" />}
      />
    );
  }

  return null;
}
