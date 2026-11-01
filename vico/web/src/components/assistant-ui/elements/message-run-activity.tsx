"use client";

/**
 * 完成态活动折叠块与工具 UI 渲染。
 *
 * CompletedActivityGroup：把推理全文 + 工具调用收进「已完成」折叠块；
 * ToolActivityContent：直接渲染单条工具的工具 UI（供折叠块内平铺）。
 */
import {type PartState, type ToolCallMessagePartProps, useAui, useMessageTiming,} from "@assistant-ui/react";
import {CheckIcon, ChevronRightIcon} from "lucide-react";
import {type ReactNode, useState} from "react";

import {cn} from "@/lib/utils";
import {toolkit} from "@/tools/toolkit";
import type {VicoToolkitDefinitionEntry} from "@/tools/tool-summary";
import {formatElapsedCn} from "../utils/task";
import {CollapsibleContent, CollapsibleRoot as Collapsible, CollapsibleTrigger,} from "./collapsible-root";
import {collapsePanel} from "./surfaces";
import {ToolFallback} from "./tool-fallback.aui";

/** `PartState` 中 tool-call 变体（含 status 的丰富 part 类型） */
type ToolCallPartState = Extract<PartState, { type: "tool-call" }>;

/**
 * 按工具名索引 toolkit 的类型视图。
 *
 * defineToolkit 的返回类型对 string 索引会退化为 ToolDefinition<any, any>，
 * 丢失 VicoToolkitDefinitionEntry 扩展的 summarize 字段；这里在消费边界收敛一次。
 */
const tools = toolkit as Record<string, VicoToolkitDefinitionEntry | undefined>;

/**
 * 直接渲染单条工具的工具 UI（toolkit 注册的 render 组件，无 render 时回退
 * ToolFallback）。render 组件所需的 addResult / resume / respondToApproval
 * 从当前消息的 part runtime 派生，保证审批与续跑按钮仍然真实可用。
 *
 * 用于折叠块内平铺展示（不再套"摘要行 + 点击展开"那层折叠）。
 */
function ToolActivityContent({ part }: { part: ToolCallPartState }) {
  const aui = useAui();
  const descriptor = tools[part.toolName];

  // 由当前消息的 part runtime 派生 render 组件需要的动作方法
  const partMethods = aui.message.part({ toolCallId: part.toolCallId });

  const renderProps: ToolCallMessagePartProps = {
    ...part,
    addResult: partMethods.addToolResult,
    resume: partMethods.resumeToolCall,
    respondToApproval: partMethods.respondToToolApproval,
  };

  const ToolUI = descriptor?.render ?? ToolFallback;
  return <ToolUI {...renderProps} />;
}

/**
 * 完成态的统一折叠块：把推理全文 + 工具调用平铺收纳进一个「已完成」块。
 *
 * 默认折叠，标题只显示「已完成，用时 xx分xx秒」（时长取流式生成时长），
 * 点击展开后 children 依次是 reasoning / tool 的渲染结果。
 */
function CompletedActivityGroup({ children }: { children: ReactNode }) {
  const timing = useMessageTiming();
  const [open, setOpen] = useState(false);

  const duration =
    timing?.totalStreamTime !== undefined
      ? formatElapsedCn(timing.totalStreamTime)
      : undefined;

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="my-2">
      <CollapsibleTrigger className="group/trigger text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 flex w-full items-center gap-1.5 rounded-md py-1 text-sm outline-none focus-visible:ring-[3px]">
        <CheckIcon
          aria-hidden="true"
          className="size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400"
        />
        <span className="text-foreground/80 tabular-nums">
          已完成
          {duration !== undefined && <>，用时 {duration}</>}
        </span>
        <ChevronRightIcon
          aria-hidden="true"
          className="size-3.5 ml-auto shrink-0 transition-transform duration-200 group-data-open/trigger:rotate-90 group-data-panel-open/trigger:rotate-90 motion-reduce:transition-none"
        />
      </CollapsibleTrigger>
      <CollapsibleContent className={cn(collapsePanel)}>
        <div className="border-border ms-1.5 flex min-w-0 flex-col gap-1 border-s ps-3.5 pt-2 text-sm wrap-anywhere">
          {children}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

export { CompletedActivityGroup, ToolActivityContent };
