/**
 * Token 用量格式化与聚合工具。
 *
 * 供消息级（message action 的 token 用量 popover）与线程级（thread 列表总用量）
 * 复用同一套缩写规则与「输入+输出」总量算法，避免两处展示口径漂移。
 */

/** 支持总量计算的用量结构（字段可缺省，兼容 UsageMetrics / MessageUsage） */
interface TokenUsageLike {
  inputTokens?: { total?: number };
  outputTokens?: { total?: number };
}

/**
 * token 数字缩写：≥1M 用 M，≥1k 用 k，其余原样；undefined 显示占位符。
 *
 * @param tokens - 待格式化的 token 数
 */
export function formatTokens(tokens: number | undefined): string {
  if (tokens === undefined) return "—";
  if (tokens >= 1_000_000)
    return `${(tokens / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (tokens >= 1_000)
    return `${(tokens / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
  return `${tokens}`;
}

/**
 * 计算输入+输出 token 总量，双方都缺省时返回 undefined。
 *
 * @param usage - 用量明细（可缺省）
 */
export function totalTokens(usage: TokenUsageLike | undefined): number | undefined {
  const input = usage?.inputTokens?.total;
  const output = usage?.outputTokens?.total;
  return input === undefined && output === undefined
    ? undefined
    : (input ?? 0) + (output ?? 0);
}
