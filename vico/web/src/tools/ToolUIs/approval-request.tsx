/**
 * 工具审批适配器 — 把 Vico 工具渲染器的 HITL 审批数据流适配到框架的 ApprovalCard。
 *
 * 框架的 elements/ApprovalCard 是纯展示组件（state + 回调 + 文案），不含任何
 * HITL 决议逻辑；本组件承载 approval / interrupt / addResult 三种决议机制，
 * 并以 state="request" 委托给 ApprovalCard 渲染 Allow/Deny 按钮，文案经 i18n 注入。
 */
import { useState, type ElementType } from "react";
import { useTranslation } from "react-i18next";
import { ShieldAlert } from "lucide-react";
import type { ToolApprovalResponse, ToolCallMessagePart } from "@assistant-ui/react";
import { ApprovalCard } from "@/components/assistant-ui/elements/approval-card";
import { cn } from "@/lib/utils";

export interface ApprovalRequestProps {
  /** 工具名称（无 title 时用于拼默认审批标题） */
  toolName: string;
  /** 审批标题（如 "天气查询需要确认"） */
  title?: string;
  /** 标题下方副标题（如文件路径），无则传空串避免布局空行 */
  subtitle?: string;
  /** 补充描述信息 */
  description?: string;
  /** 命令/参数内容（mono 字段展示） */
  command?: string;
  /** 标题图标 */
  icon?: ElementType;
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
 * 工具审批适配器。
 *
 * 决议逻辑与框架展示解耦：判定已裁决则返回 null（交父渲染器展示结果态），
 * 否则将 Allow/Deny 决议写入对应 HITL 通道，再委托 ApprovalCard 渲染。
 */
export function ApprovalRequest({
  toolName,
  title,
  subtitle,
  description,
  command,
  icon: Icon = ShieldAlert,
  approval,
  interrupt,
  resume,
  addResult,
  respondToApproval,
  className,
}: ApprovalRequestProps) {
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
    <ApprovalCard
      state="request"
      title={title ?? t("tool.approvalRequired", { name: toolName })}
      subtitle={subtitle ?? ""}
      description={description}
      command={command}
      icon={<Icon className="size-4" />}
      onAllowOnce={() => respond(true)}
      onDeny={() => respond(false)}
      allowOnceLabel={t("tool.allowOnce")}
      denyLabel={t("tool.denyOnce")}
      className={cn("my-2", className)}
    />
  );
}
