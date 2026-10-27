"use client";

import { useAuiState, type PartState } from "@assistant-ui/react";
import { WrenchIcon } from "lucide-react";
import { useMemo, useState } from "react";

import { ToolTimeline, type TimelineStep } from "./tool-timeline";

/** `PartState` 中 tool-call 变体（含 status 的丰富 part 类型） */
type ToolCallPartState = Extract<PartState, { type: "tool-call" }>;

/**
 * 把当前 assistant 消息里的 tool-call parts 汇总成一条折叠式 ToolTimeline。
 *
 * 放在消息正文（MessagePrimitive.GroupedParts）之后，作为该条消息工具调用的
 * 一行汇总；保留原有逐条 ToolFallback 渲染，两者互补。
 */
export function MessageToolTimeline() {
  // 当前消息的 parts（store 内引用稳定，避免每次 selector 返回新数组）
  const parts = useAuiState((s) => s.message.parts);
  const streaming = useAuiState((s) => s.message.status?.type === "running");

  const [open, setOpen] = useState(false);

  // 仅取 tool-call part，映射为 timeline 步骤
  const steps = useMemo<TimelineStep[]>(() => {
    return parts
      .filter((part): part is ToolCallPartState => part.type === "tool-call")
      .map((part) => ({
        id: part.toolCallId,
        verb: "Used tool",
        chip: part.toolName,
        icon: WrenchIcon,
      }));
  }, [parts]);

  if (steps.length === 0) return null;

  const restingLabel = steps.length === 1 ? "1 tool" : `${steps.length} tools`;

  return (
    <ToolTimeline
      steps={steps}
      visibleSteps={steps.length}
      streaming={streaming}
      open={open}
      onOpenChange={setOpen}
      restingLabel={restingLabel}
      activeLabel="Running tools"
      stats={[]}
      className="ms-2 mt-1.5"
    />
  );
}
