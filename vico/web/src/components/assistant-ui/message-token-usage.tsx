"use client";

import { useAuiState } from "@assistant-ui/react";
import { Coins } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { formatTokens, totalTokens } from "@/lib/token-format";
import type { FC } from "react";
import type { MessageUsage } from "@/types/models";

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
 * 在 assistant 消息 action 栏展示 token 用量：触发按钮以图标+输入输出总量呈现，
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
  const { t } = useTranslation("assistant");
  const usage = useAuiState<MessageUsage | undefined>((s) =>
    s.message.role === "assistant"
      ? (s.message.metadata?.custom?.usage as MessageUsage | undefined)
      : undefined,
  );

  if (!usage) return null;

  const input = usage.inputTokens;
  const output = usage.outputTokens;
  const total = totalTokens(usage);

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
          aria-label={t("message.tokenUsage.label")}
          className={cn(
            "text-muted-foreground hover:bg-accent hover:text-accent-foreground flex items-center gap-1 rounded-md p-1 font-mono text-xs tabular-nums transition-colors data-[state=open]:bg-accent data-[state=open]:text-accent-foreground",
            className,
          )}
        >
          <Coins className="size-4 shrink-0 opacity-70" />
          <span>{formatTokens(total)}</span>
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
          <div className="flex items-center justify-between gap-6">
            <span className="flex items-center gap-1.5 font-medium">
              <Coins className="size-4 shrink-0 opacity-70" />
              {t("message.tokenUsage.label")}
            </span>
            <span className="font-mono tabular-nums">{formatTokens(total)}</span>
          </div>

          {(hasInput || hasOutput) && (
            <div className="bg-foreground/[0.08] mt-2.5 h-px" />
          )}

          {hasInput && (
            <div className="mt-2.5 grid gap-1.5">
              <div className="text-muted-foreground/80 text-[11px] font-medium uppercase tracking-wide">
                {t("message.tokenUsage.input")}
              </div>
              <UsageRow label={t("message.tokenUsage.total")} tokens={input?.total} />
              <UsageRow label={t("message.tokenUsage.noCache")} tokens={input?.noCache} />
              <UsageRow label={t("message.tokenUsage.cacheRead")} tokens={input?.cacheRead} />
              <UsageRow label={t("message.tokenUsage.cacheWrite")} tokens={input?.cacheWrite} />
            </div>
          )}

          {hasInput && hasOutput && (
            <div className="bg-foreground/[0.08] mt-2.5 h-px" />
          )}

          {hasOutput && (
            <div className="mt-2.5 grid gap-1.5">
              <div className="text-muted-foreground/80 text-[11px] font-medium uppercase tracking-wide">
                {t("message.tokenUsage.output")}
              </div>
              <UsageRow label={t("message.tokenUsage.total")} tokens={output?.total} />
              <UsageRow label={t("message.tokenUsage.text")} tokens={output?.text} />
              <UsageRow label={t("message.tokenUsage.reasoning")} tokens={output?.reasoning} />
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
};
