"use client";

import { type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import { ShieldAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ToolApprovalResponse, ToolCallMessagePart } from "@assistant-ui/react";
import { field, inkButton, paper } from "./surfaces";

export interface ApprovalCardProps {
  /** 工具名称（展示用） */
  toolName: string;
  /** 审批标题（如 "天气查询需要确认"），不传则默认 "{toolName} 需要确认" */
  title?: string;
  /** 标题右侧补充信息（如文件/目录路径），mono 字体展示 */
  subtitle?: string;
  /** 补充描述信息 */
  description?: string;
  /** 命令/参数内容（mono 字段展示），与 children 二选一 */
  command?: string;
  /** 额外内容（参数展示等） */
  children?: ReactNode;
  /** 自定义图标 */
  icon?: React.ElementType;
  /** 服务端审批门禁状态（未决时 respondToApproval 才有效） */
  approval?: ToolCallMessagePart["approval"];
  /** 前端 human 工具的中断请求（需 resume 恢复） */
  interrupt?: ToolCallMessagePart["interrupt"];
  /** 恢复 human 工具（interrupt）执行 */
  resume?: (payload: unknown) => void;
  /** 直接写入工具结果。result 类型随各工具 TResult 泛型而异，any 与 @assistant-ui/react 内部一致 */
  addResult?: (result: any) => void;
  /** 服务端审批决议回调 */
  respondToApproval?: (response: ToolApprovalResponse) => void;
  className?: string;
}

/**
 * 通用工具审批卡片 — 统一的 Allow/Deny 审批样式（HITL 三机制 + i18n）。
 *
 * 可被各工具渲染器（exec、weather、knowledge-search、ToolCard）在 requires-action 态复用，
 * 避免每个工具重复实现相同的审批 UI。基于 elements 的 surfaces 设计令牌（paper/field/inkButton）。
 */
export function ApprovalCard({
  toolName,
  title,
  subtitle,
  description,
  command,
  children,
  icon: Icon = ShieldAlert,
  approval,
  interrupt,
  resume,
  addResult,
  respondToApproval,
  className,
}: ApprovalCardProps) {
  const { t } = useTranslation("assistant");
  const [submitted, setSubmitted] = useState(false);

  // 审批已裁决（已批准/拒绝/取消/过期）→ 不再渲染审批按钮，交由父渲染器展示结果态
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
      respondToApproval({ approved });
    } else if (interrupt) {
      resume?.({ approved });
    } else {
      addResult?.(approved ? t("tool.approvedResult") : t("tool.deniedResult"));
    }
    setSubmitted(true);
  };

  return (
    <div
      data-slot="approval-card"
      className={cn(
        paper,
        "flex w-full flex-col gap-3.5 rounded-[20px] p-4 my-2",
        className,
      )}
    >
      <div className="flex items-center gap-3">
        <span className="bg-foreground/[0.05] text-foreground/45 flex size-9 shrink-0 items-center justify-center rounded-xl">
          <Icon className="size-4" />
        </span>
        <div className="flex min-w-0 flex-col">
          <p className="text-[13.5px] font-medium">
            {title ?? t("tool.approvalRequired", { name: toolName })}
          </p>
          {subtitle && (
            <p className="text-foreground/45 text-xs font-mono truncate">
              {subtitle}
            </p>
          )}
        </div>
      </div>

      {description && (
        <p className="text-foreground/70 text-xs">{description}</p>
      )}

      {command && (
        <div
          className={cn(
            field,
            "text-foreground/70 rounded-xl px-3.5 py-2.5 font-mono text-xs",
          )}
        >
          {command}
        </div>
      )}

      {children}

      <div className="flex h-8 items-center justify-end gap-2">
        <button
          type="button"
          onClick={() => respond(false)}
          disabled={submitted}
          className="text-foreground/55 hover:bg-foreground/[0.06] hover:text-foreground/90 h-8 rounded-full px-3.5 text-xs font-medium transition-[background-color,color,scale] duration-150 active:scale-[0.96] disabled:opacity-50"
        >
          {t("tool.denyOnce")}
        </button>
        <button
          type="button"
          onClick={() => respond(true)}
          disabled={submitted}
          className={cn(
            inkButton,
            "flex h-8 items-center rounded-full px-3.5 text-xs font-medium disabled:opacity-50",
          )}
        >
          {t("tool.allowOnce")}
        </button>
      </div>
    </div>
  );
}
