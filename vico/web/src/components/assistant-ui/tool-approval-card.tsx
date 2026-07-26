"use client";

import {type ReactNode, useState} from "react";
import {ShieldAlert} from "lucide-react";
import {Button} from "@/components/ui/button";
import {cn} from "@/lib/utils";
import {ToolApprovalResponse} from "@assistant-ui/react";

/** 审批响应函数签名 */
type ApproveFn = (response: ToolApprovalResponse) => void;

export interface ToolApprovalCardProps {
  /** 工具名称（展示用） */
  toolName: string;
  /** 审批标题（如 "天气查询需要确认"），不传则默认 "{toolName} 需要确认" */
  title?: string;
  /** 补充描述信息 */
  description?: string;
  /** 额外内容（参数展示等） */
  children?: ReactNode;
  /** 自定义图标 */
  icon?: React.ElementType;
  /** assistant-ui approve 回调 */
  respondToApproval?: ApproveFn;
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
  description,
  children,
  icon: Icon = ShieldAlert,
  respondToApproval,
  className,
}: ToolApprovalCardProps) {
  const [submitted, setSubmitted] = useState(false);

  const respond = (approved: boolean) => {
    if (submitted) return;
    respondToApproval?.({ approved });
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
          {title ?? `${toolName} 需要确认`}
        </span>
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
          允许
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => respond(false)}
          disabled={submitted}
        >
          拒绝
        </Button>
      </div>
    </div>
  );
}
