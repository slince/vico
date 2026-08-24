"use client";

import {type ReactNode, useState} from "react";
import {useTranslation} from "react-i18next";
import {ShieldAlert} from "lucide-react";
import {Button} from "@/components/ui/button";
import {cn} from "@/lib/utils";
import type {ToolApprovalResponse, ToolCallMessagePart} from "@assistant-ui/react";

export interface ToolApprovalCardProps {
  /** 工具名称（展示用） */
  toolName: string;
  /** 审批标题（如 "天气查询需要确认"），不传则默认 "{toolName} 需要确认" */
  title?: string;
  /** 标题右侧补充信息（如文件/目录路径），mono 字体展示 */
  subtitle?: string;
  /** 补充描述信息 */
  description?: string;
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
 * 通用工具审批卡片 — 统一的 Allow/Deny 审批样式。
 *
 * 可被各工具渲染器（weather、exec 等）复用，
 * 避免每个工具重复实现相同的审批 UI。
 */
export function ToolApprovalCard({
  toolName,
  title,
  subtitle,
  description,
  children,
  icon: Icon = ShieldAlert,
  approval,
  interrupt,
  resume,
  addResult,
  respondToApproval,
  className,
}: ToolApprovalCardProps) {
  const {t} = useTranslation("assistant");
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
      className={cn(
        "border rounded-lg p-4 my-2 bg-muted/30 space-y-2",
        className,
      )}
    >
      <div className="flex items-center gap-2">
        <Icon size={14} className="text-muted-foreground" />
        <span className="text-sm font-medium">
          {title ?? t("tool.approvalRequired", {name: toolName})}
        </span>
        {subtitle && (
          <span className="font-mono text-xs text-muted-foreground truncate max-w-[50%]">
            {subtitle}
          </span>
        )}
      </div>

      {description && (
        <p className="text-xs text-muted-foreground">{description}</p>
      )}

      {children}

      <div className="flex gap-2">
        <Button
          size="sm"
          variant="default"
          onClick={() => respond(true)}
          disabled={submitted}
        >
          {t("tool.allowOnce")}
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => respond(false)}
          disabled={submitted}
        >
          {t("tool.denyOnce")}
        </Button>
      </div>
    </div>
  );
}
