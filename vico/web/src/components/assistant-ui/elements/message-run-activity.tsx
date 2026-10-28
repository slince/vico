"use client";

import {
  useAui,
  useAuiState,
  useMessageTiming,
  type MessageStatus,
  type PartState,
  type ToolCallMessagePartProps,
} from "@assistant-ui/react";
import { ChevronRightIcon, WrenchIcon } from "lucide-react";
import { useMemo, useState } from "react";

import { cn } from "@/lib/utils";
import { toolkit } from "@/tools/toolkit";
import type { VicoToolkitDefinitionEntry } from "@/tools/tool-summary";
import {
  formatElapsed,
  taskLabel,
  taskStateOf,
} from "../utils/task";
import {
  CollapsibleRoot as Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "./collapsible-root";
import { collapsePanel } from "./surfaces";
import { ToolFallback } from "./tool-fallback.aui";
import {
  RunActivity,
  type RunActivityEntry,
  type RunActivityStatus,
} from "./run-activity";

/** `PartState` 中 tool-call 变体（含 status 的丰富 part 类型） */
type ToolCallPartState = Extract<PartState, { type: "tool-call" }>;

/** 未知工具的回退摘要 — 仅提供默认图标 */
const FALLBACK_SUMMARY = { icon: WrenchIcon };

/**
 * 按工具名索引 toolkit 的类型视图。
 *
 * defineToolkit 的返回类型对 string 索引会退化为 ToolDefinition<any, any>，
 * 丢失 VicoToolkitDefinitionEntry 扩展的 summarize 字段；这里在消费边界收敛一次。
 */
const tools = toolkit as Record<string, VicoToolkitDefinitionEntry | undefined>;

/**
 * 把 message 级状态映射为 RunActivity 的 status。
 * 未定义时（占位消息等边缘情况）按已结束处理。
 */
function runStatusOf(status: MessageStatus | undefined): RunActivityStatus {
  switch (status?.type) {
    case "running":
      return "running";
    case "requires-action":
      return "requires-action";
    case "complete":
      return "complete";
    case "incomplete":
      if (status.reason === "cancelled") return "cancelled";
      if (status.reason === "error") return "error";
      return "incomplete";
    default:
      return "complete";
  }
}

/** 各状态下的摘要文案（durationLabel 会紧随其后） */
const STATUS_LABELS: Record<RunActivityStatus, string> = {
  running: "Working",
  "requires-action": "Needs your input",
  complete: "Worked for",
  cancelled: "Stopped after",
  incomplete: "Stopped after",
  error: "Failed after",
};

/**
 * 单条工具的摘要行：图标 + 标题 + 描述（三部分），点击展开该工具的工具 UI。
 *
 * 展开后的 UI 复用该工具在 toolkit 里注册的 render 组件（无 render 时回退
 * ToolFallback）。render 组件所需的 addResult / resume / respondToApproval
 * 从当前消息的 part runtime 派生，保证审批与续跑按钮仍然真实可用。
 */
function ToolRunActivityRow({ part }: { part: ToolCallPartState }) {
  const aui = useAui();
  const descriptor = tools[part.toolName];
  const summary = descriptor?.summarize?.(part.args);

  const [open, setOpen] = useState(false);

  // 由当前消息的 part runtime 派生 render 组件需要的动作方法
  const partMethods = aui.message.part({ toolCallId: part.toolCallId });

  const renderProps: ToolCallMessagePartProps = {
    ...part,
    addResult: partMethods.addToolResult,
    resume: partMethods.resumeToolCall,
    respondToApproval: partMethods.respondToToolApproval,
  };

  const ToolUI = descriptor?.render ?? ToolFallback;
  const Icon = summary?.icon ?? FALLBACK_SUMMARY.icon;
  const title = summary?.title ?? part.toolName;
  const description = summary?.description;
  const view = taskStateOf(part.status, part.isError);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="group/trigger text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 flex w-full items-center gap-2 rounded-md py-1 text-start text-sm outline-none focus-visible:ring-[3px]">
        <Icon
          aria-hidden="true"
          className={cn(
            "size-3.5 shrink-0",
            view === "working" && "animate-spin [animation-duration:0.8s]",
            view === "done" && "text-emerald-600 dark:text-emerald-400",
          )}
        />
        <span className="text-foreground/90 shrink-0 font-mono text-[11px]">
          {title}
        </span>
        {description !== undefined && description !== "" && (
          <span className="min-w-0 flex-1 truncate">{description}</span>
        )}
        <ChevronRightIcon
          aria-hidden="true"
          className="size-3.5 shrink-0 transition-transform duration-200 group-data-open/trigger:rotate-90 group-data-panel-open/trigger:rotate-90 motion-reduce:transition-none"
        />
      </CollapsibleTrigger>

      <CollapsibleContent className={cn(collapsePanel)}>
        <div className="pt-1 pb-2">
          <ToolUI {...renderProps} />
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

/**
 * 把当前 assistant 消息里的工具调用汇总成一条 RunActivity。
 *
 * 折叠时是一行摘要（状态 + 时长）；展开后逐条展示 icon/title/description，
 * 每行可再点击展开该工具的工具 UI。工具详情只在这里出现，正文不再重复渲染。
 */
export function MessageRunActivity() {
  const parts = useAuiState((s) => s.message.parts);
  const messageStatus = useAuiState((s) => s.message.status);
  const timing = useMessageTiming();
  const [open, setOpen] = useState(false);

  // 仅取 tool-call part，映射为可点击展开的详情条目
  const entries = useMemo<RunActivityEntry[]>(() => {
    return parts
      .filter((part): part is ToolCallPartState => part.type === "tool-call")
      .map((part) => {
        const summary = tools[part.toolName]?.summarize?.(part.args);

        return {
          id: part.toolCallId,
          kind: "tool",
          label: summary?.description ?? taskLabel(part.toolName, part.args),
          content: <ToolRunActivityRow part={part} />,
        };
      });
  }, [parts]);

  if (entries.length === 0) return null;

  const status = runStatusOf(messageStatus);
  const statusLabel = STATUS_LABELS[status];

  // 仅已结束的状态带时长；流式中的计时不进入摘要
  const settled = status !== "running" && status !== "requires-action";
  const durationLabel =
    settled && timing?.totalStreamTime !== undefined
      ? formatElapsed(timing.totalStreamTime)
      : undefined;

  return (
    <RunActivity
      status={status}
      statusLabel={statusLabel}
      durationLabel={durationLabel}
      entries={entries}
      open={open}
      onOpenChange={setOpen}
      className="ms-2 mt-1.5"
    />
  );
}
