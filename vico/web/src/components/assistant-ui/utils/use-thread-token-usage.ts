"use client";

import { useMemo } from "react";
import { useAuiState } from "@assistant-ui/react";
import { totalTokens } from "@/lib/token-format";
import type { MessageUsage } from "@/types/models";
import type { TokenUsage } from "./context-usage";

/**
 * 后端嵌套 UsageMetrics → ContextDisplay 扁平 TokenUsage。
 *
 * 后端把单次模型调用的用量持久化到 assistant 消息的 metadata.custom.usage，
 * 结构为 inputTokens / outputTokens 各自一个对象（total/noCache/cacheRead/…）。
 * assistant-ui 的 ContextDisplay 与 useThreadTokenUsage 只认扁平数字字段，
 * 这里做一次映射（cachedInputTokens 取 cacheRead，reasoningTokens 取 output.reasoning）。
 *
 * @param usage - 后端持久化的嵌套用量
 */
export function toFlatTokenUsage(usage: MessageUsage): TokenUsage {
  const input = usage.inputTokens;
  const output = usage.outputTokens;
  return {
    totalTokens: totalTokens(usage),
    inputTokens: input?.total,
    outputTokens: output?.total,
    cachedInputTokens: input?.cacheRead,
    reasoningTokens: output?.reasoning,
  };
}

/** 在消息树中自后向前找最新一条带有效用量的 assistant 消息 */
function findLatestMessageWithUsage(
  messages: readonly { role?: string; metadata?: { custom?: Record<string, unknown> } }[] | undefined,
): { role?: string; metadata?: { custom?: Record<string, unknown> } } | undefined {
  if (!messages) return undefined;
  for (let idx = messages.length - 1; idx >= 0; idx -= 1) {
    const message = messages[idx]!;
    if (message.role !== "assistant") continue;
    const usage = message.metadata?.custom?.usage as MessageUsage | undefined;
    if (usage && totalTokens(usage) !== undefined) return message;
  }
  return undefined;
}

/**
 * 读取当前线程最新一条带用量的 assistant 消息，返回扁平 TokenUsage。
 *
 * 语义对齐 assistant-ui 的 useThreadTokenUsage，但适配本应用后端的嵌套 usage 结构；
 * assistant-ui 原版只认扁平字段，对本应用的嵌套结构会返回 undefined。
 */
export function useThreadTokenUsage(): TokenUsage | undefined {
  const message = useAuiState((s) => findLatestMessageWithUsage(s.thread.messages));
  return useMemo(() => {
    if (!message) return undefined;
    const usage = message.metadata?.custom?.usage as MessageUsage | undefined;
    return usage ? toFlatTokenUsage(usage) : undefined;
  }, [message]);
}
