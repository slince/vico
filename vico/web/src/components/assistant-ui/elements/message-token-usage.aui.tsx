"use client";

import { useAuiState } from "@assistant-ui/react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { FC } from "react";

/**
 * 单条 assistant 消息的 token 用量明细（对齐后端 UsageMetrics 持久化结构）。
 * 各字段可能为 undefined（provider 未上报对应明细时）。
 */
export interface MessageUsage {
  inputTokens?: {
    total?: number;
    noCache?: number;
    cacheRead?: number;
    cacheWrite?: number;
  };
  outputTokens?: {
    total?: number;
    text?: number;
    reasoning?: number;
  };
}

/** 数字缩写：≥1M 用 M，≥1k 用 k，其余原样；undefined 显示占位 */
const formatTokens = (tokens: number | undefined): string => {
  if (tokens === undefined) return "—";
  if (tokens >= 1_000_000)
    return `${(tokens / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (tokens >= 1_000)
    return `${(tokens / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
  return `${tokens}`;
};

/** 两个 token 数安全相加：双方都 undefined 时保持 undefined */
const addTokens = (a?: number, b?: number): number | undefined =>
  a === undefined && b === undefined ? undefined : (a ?? 0) + (b ?? 0);

/** 单行用量明细（label / value），值为 undefined 时不渲染 */
const UsageRow: FC<{ label: string; tokens: number | undefined }> = ({
  label,
  tokens,
}) => {
  if (tokens === undefined) return null;
  return (
    <div className="flex items-baseline justify-between gap-6">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono tabular-nums">{formatTokens(tokens)}</span>
    </div>
  );
};

/**
 * 在 assistant 消息 action 栏展示 token 用量：触发按钮显示输入+输出总量，
 * 点击弹出 popover 渲染完整使用明细（缓存读写、文本/推理拆分）。
 *
 * 用法同 MessageTiming，置于 `ActionBarPrimitive.Root` 内：
 *
 * ```tsx
 * <ActionBarPrimitive.Root>
 *   <ActionBarPrimitive.Copy />
 *   <MessageTokenUsage />  // <-- add this
 * </ActionBarPrimitive.Root>
 * ```
 *
 * usage 经后端持久化到消息 metadata，并经 history / 流式 messageMetadata 两条路径
 * 到达前端，统一落在 `metadata.custom.usage`。
 */
export const MessageTokenUsage: FC<{
  className?: string;
  side?: "top" | "right" | "bottom" | "left";
}> = ({ className, side = "bottom" }) => {
  const usage = useAuiState<MessageUsage | undefined>((s) =>
    s.message.role === "assistant"
      ? (s.message.metadata?.custom?.usage as MessageUsage | undefined)
      : undefined,
  );

  if (!usage) return null;

  const input = usage.inputTokens;
  const output = usage.outputTokens;
  const total = addTokens(input?.total, output?.total);

  // 无任何有效 token 数时不渲染
  if (total === undefined) return null;

  const hasInput =
    input !== undefined &&
    (input.total !== undefined ||
      input.noCache !== undefined ||
      input.cacheRead !== undefined ||
      input.cacheWrite !== undefined);
  const hasOutput =
    output !== undefined &&
    (output.total !== undefined ||
      output.text !== undefined ||
      output.reasoning !== undefined);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-slot="message-token-usage-trigger"
          aria-label="Token usage"
          className={cn(
            "text-muted-foreground hover:bg-accent hover:text-accent-foreground flex items-center rounded-md p-1 font-mono text-xs tabular-nums transition-colors data-[state=open]:bg-accent data-[state=open]:text-accent-foreground",
            className,
          )}
        >
          {formatTokens(total)}
        </button>
      </PopoverTrigger>
      <PopoverContent
        side={side}
        align="start"
        sideOffset={6}
        data-slot="message-token-usage-popover"
        className="w-56 p-3"
      >
        <div className="text-xs">
          <div className="flex items-baseline justify-between gap-6">
            <span className="font-medium">Token usage</span>
            <span className="font-mono tabular-nums">{formatTokens(total)}</span>
          </div>

          {hasInput && (
            <div className="mt-3 grid gap-1.5">
              <div className="text-muted-foreground/80 text-[11px] font-medium uppercase tracking-wide">
                Input
              </div>
              <UsageRow label="Total" tokens={input?.total} />
              <UsageRow label="No cache" tokens={input?.noCache} />
              <UsageRow label="Cache read" tokens={input?.cacheRead} />
              <UsageRow label="Cache write" tokens={input?.cacheWrite} />
            </div>
          )}

          {hasOutput && (
            <div className="mt-3 grid gap-1.5">
              <div className="text-muted-foreground/80 text-[11px] font-medium uppercase tracking-wide">
                Output
              </div>
              <UsageRow label="Total" tokens={output?.total} />
              <UsageRow label="Text" tokens={output?.text} />
              <UsageRow label="Reasoning" tokens={output?.reasoning} />
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
};
