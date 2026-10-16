// @vico/core - UsageMetrics 构造与累加工具
import type {LanguageModelV4Usage} from '@ai-sdk/provider';

import type {UsageMetrics} from './types.js';

/** 空用量 — 所有明细字段为 undefined */
export function emptyUsage(): UsageMetrics {
  return {
    inputTokens: { total: undefined, noCache: undefined, cacheRead: undefined, cacheWrite: undefined },
    outputTokens: { total: undefined, text: undefined, reasoning: undefined },
  };
}

/** 两个 token 数安全相加：双方都 undefined 时保持 undefined，否则按 0 相加 */
export function addTokenCount(a: number | undefined, b: number | undefined): number | undefined {
  return a == null && b == null ? undefined : (a ?? 0) + (b ?? 0);
}

/** 累加两次用量（逐字段 undefined 安全相加），供 loop 跨 step 累计 turn 总量 */
export function addUsage(a: UsageMetrics, b: UsageMetrics): UsageMetrics {
  return {
    inputTokens: {
      total: addTokenCount(a.inputTokens.total, b.inputTokens.total),
      noCache: addTokenCount(a.inputTokens.noCache, b.inputTokens.noCache),
      cacheRead: addTokenCount(a.inputTokens.cacheRead, b.inputTokens.cacheRead),
      cacheWrite: addTokenCount(a.inputTokens.cacheWrite, b.inputTokens.cacheWrite),
    },
    outputTokens: {
      total: addTokenCount(a.outputTokens.total, b.outputTokens.total),
      text: addTokenCount(a.outputTokens.text, b.outputTokens.text),
      reasoning: addTokenCount(a.outputTokens.reasoning, b.outputTokens.reasoning),
    },
  };
}

/** V4 usage → UsageMetrics（丢弃 raw，避免把 provider 任意 JSON 写进消息 metadata） */
export function fromV4Usage(u: LanguageModelV4Usage): UsageMetrics {
  return {
    inputTokens: { ...u.inputTokens },
    outputTokens: { ...u.outputTokens },
  };
}
