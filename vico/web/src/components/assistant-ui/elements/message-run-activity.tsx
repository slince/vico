"use client";

import {
  useAuiState,
  useMessageTiming,
  type MessageStatus,
  type PartState,
} from "@assistant-ui/react";
import {
  AlertCircleIcon,
  CheckIcon,
  LoaderIcon,
  XCircleIcon,
  type LucideIcon,
} from "lucide-react";
import { useMemo, useState } from "react";

import { cn } from "@/lib/utils";
import { formatElapsed, taskLabel, taskStateOf, type TaskViewState } from "../utils/task";
import {
  ToolFallbackArgs,
  ToolFallbackError,
  ToolFallbackResult,
} from "./tool-fallback.aui";
import { RunActivity, type RunActivityEntry, type RunActivityStatus } from "./run-activity";

/** `PartState` 中 tool-call 变体（含 status 的丰富 part 类型） */
type ToolCallPartState = Extract<PartState, { type: "tool-call" }>;

/** 每个 tool entry 顶部的状态图标 */
const STATUS_ICONS: Record<TaskViewState, LucideIcon> = {
  working: LoaderIcon,
  waiting: AlertCircleIcon,
  done: CheckIcon,
  failed: XCircleIcon,
  cancelled: XCircleIcon,
};

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
 * 单条 tool 的详情块：状态图标 + 人类可读标签 + 工具名，以及请求/结果/错误。
 */
function ToolEntryContent({ part }: { part: ToolCallPartState }) {
  const label = taskLabel(part.toolName, part.args);
  const view = taskStateOf(part.status, part.isError);
  const StatusIcon = STATUS_ICONS[view];

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <StatusIcon
          className={cn(
            "size-3.5 shrink-0 text-muted-foreground",
            view === "working" && "animate-spin [animation-duration:0.8s]",
            view === "done" && "text-emerald-600 dark:text-emerald-400",
            (view === "failed" || view === "cancelled") &&
              "text-muted-foreground",
          )}
        />
        <span className="text-foreground/90 font-medium">{label}</span>
        <span className="text-muted-foreground font-mono text-[11px]">
          {part.toolName}
        </span>
      </div>

      <ToolFallbackError status={part.status} />
      <ToolFallbackArgs argsText={part.argsText} />
      <ToolFallbackResult result={part.result} />
    </div>
  );
}

/**
 * 把当前 assistant 消息里的工具调用汇总成一条 RunActivity。
 *
 * 放在消息正文之后：折叠时是一行摘要（状态 + 时长），展开后逐条展示
 * 每个工具的请求参数与结果；保留原有逐条 ToolFallback 渲染，两者互补。
 */
export function MessageRunActivity() {
  const parts = useAuiState((s) => s.message.parts);
  const messageStatus = useAuiState((s) => s.message.status);
  const timing = useMessageTiming();
  const [open, setOpen] = useState(false);

  // 仅取 tool-call part，映射为详情条目
  const entries = useMemo<RunActivityEntry[]>(() => {
    return parts
      .filter((part): part is ToolCallPartState => part.type === "tool-call")
      .map((part) => ({
        id: part.toolCallId,
        kind: "tool",
        label: taskLabel(part.toolName, part.args),
        content: <ToolEntryContent part={part} />,
      }));
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
