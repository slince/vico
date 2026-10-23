// @vico/stream - UsageMetrics 构造与累加工具

import type {UsageMetrics} from '@vico/types';

// 空用量与 V4 usage 转换已上移到 @vico/model（模型调用用量归属 model 层），此处 re-export 保持对外兼容
export { emptyUsage, fromV4Usage } from '@vico/model';

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
