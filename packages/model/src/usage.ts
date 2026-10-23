// @vico/model - 模型调用用量工具（空用量与 V4 usage 转换）

import type {LanguageModelV4Usage} from '@ai-sdk/provider';

import type {UsageMetrics} from '@vico/types';

/** 空用量 — 所有明细字段为 undefined */
export function emptyUsage(): UsageMetrics {
  return {
    inputTokens: { total: undefined, noCache: undefined, cacheRead: undefined, cacheWrite: undefined },
    outputTokens: { total: undefined, text: undefined, reasoning: undefined },
  };
}

/** V4 usage → UsageMetrics（丢弃 raw，避免把 provider 任意 JSON 写进消息 metadata） */
export function fromV4Usage(u: LanguageModelV4Usage): UsageMetrics {
  return {
    inputTokens: { ...u.inputTokens },
    outputTokens: { ...u.outputTokens },
  };
}
