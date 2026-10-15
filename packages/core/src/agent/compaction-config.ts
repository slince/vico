// @vico/core - 压缩配置解析与区间选择（对齐 deepseek resolveCompactSpec / selectCompactableRange）
export interface CompactionModelPolicy {
  provider: string;
  model: string;
  thresholdRatio?: number;
  headroomTokens?: number;
  retainRatio?: number;
  retainTokens?: number;
  summarizationProvider?: string;
  summarizationModel?: string;
  maxTokens?: number;
  compactionRetries?: number;
  maxOverflowRetries?: number;
}

/** 压缩设置（字段语义对齐 deepseek BasicCompactionConfig；v1 不做 modelPolicies 精确覆盖） */
export interface CompactionSettings {
  auto?: boolean;
  thresholdRatio?: number;
  headroomTokens?: number;
  retainRatio?: number;
  retainTokens?: number;
  summarizationProvider?: string;
  summarizationModel?: string;
  maxTokens?: number;
  compactionRetries?: number;
  maxOverflowRetries?: number;
  modelPolicies?: CompactionModelPolicy[];
}

/** 解析后的压缩设置（全部非可选） */
export interface ResolvedCompactionSettings {
  auto: boolean;
  thresholdRatio: number;
  headroomTokens: number;
  retainRatio: number;
  retainTokens?: number;
  summarizationProvider?: string;
  summarizationModel?: string;
  maxTokens: number;
  compactionRetries: number;
  maxOverflowRetries: number;
  modelPolicies?: CompactionModelPolicy[];
}

export const DEFAULT_COMPACTION_SETTINGS: ResolvedCompactionSettings = {
  auto: true,
  thresholdRatio: 0.8,
  headroomTokens: 65536,
  retainRatio: 0.16,
  maxTokens: 65536,
  compactionRetries: 1,
  maxOverflowRetries: 1,
};

/**
 * 校验并合并压缩设置，产出全非可选字段的解析结果。
 * 校验规则照搬 deepseek resolveConfig：retainRatio/retainTokens 互斥、retainRatio < thresholdRatio、
 * summarizationProvider/Model 成对、modelPolicies 无重复 target。
 */
export function resolveSettings(settings: Partial<CompactionSettings> = {}): ResolvedCompactionSettings {
  if (settings.retainRatio !== undefined && settings.retainTokens !== undefined) {
    throw new Error('retainRatio and retainTokens are mutually exclusive');
  }
  if (settings.summarizationProvider !== undefined && settings.summarizationModel === undefined
    || settings.summarizationProvider === undefined && settings.summarizationModel !== undefined) {
    throw new Error('summarizationProvider and summarizationModel must be set together');
  }
  const merged: ResolvedCompactionSettings = {
    ...DEFAULT_COMPACTION_SETTINGS,
    ...settings,
    maxTokens: settings.maxTokens ?? settings.headroomTokens ?? DEFAULT_COMPACTION_SETTINGS.headroomTokens,
  };
  // thresholdRatio 默认值在 spread 后可能被覆盖为显式值；按最终值校验 retainRatio < thresholdRatio
  if (merged.retainRatio >= merged.thresholdRatio) {
    throw new Error('retainRatio must be less than thresholdRatio');
  }
  if (merged.modelPolicies) {
    const seen = new Set<string>();
    for (const p of merged.modelPolicies) {
      const key = `${p.provider}:${p.model}`;
      if (seen.has(key)) throw new Error(`duplicate modelPolicy target: ${key}`);
      seen.add(key);
    }
  }
  return merged;
}

/** 预算解析结果 */
export interface ResolvedCompactSpec {
  messageBudgetTokens: number;
  pressureBudgetTokens: number;
  thresholdTokens: number;
  retainTokens: number;
  headroomTokens: number;
  maxTokens: number;
}

/**
 * 解析压缩预算（对齐 deepseek resolveCompactSpec）。
 * messageBudget = contextWindow − reservedCompletionTokens；pressureBudget = messageBudget − headroomTokens；
 * thresholdTokens = floor(min(contextWindow×thresholdRatio, pressureBudget))；retainTokens = 显式 ?? floor(messageBudget×retainRatio)。
 */
export function resolveCompactSpec(
  settings: ResolvedCompactionSettings,
  contextWindow: number,
  reservedCompletionTokens: number,
): ResolvedCompactSpec {
  const messageBudgetTokens = contextWindow - reservedCompletionTokens;
  const pressureBudgetTokens = messageBudgetTokens - settings.headroomTokens;
  if (pressureBudgetTokens <= 0) {
    throw new Error('pressure budget tokens must be positive');
  }
  const thresholdTokens = Math.floor(Math.min(contextWindow * settings.thresholdRatio, pressureBudgetTokens));
  const retainTokens = settings.retainTokens ?? Math.floor(messageBudgetTokens * settings.retainRatio);
  if (retainTokens >= thresholdTokens) {
    throw new Error('retainTokens must be less than thresholdTokens');
  }
  return {
    messageBudgetTokens,
    pressureBudgetTokens,
    thresholdTokens,
    retainTokens,
    headroomTokens: settings.headroomTokens,
    maxTokens: settings.maxTokens,
  };
}

/** 单个 turn 的 token 预算（供区间选择按 turn 边界累计） */
export interface TurnTokenBudget {
  turnId: string;
  routeTokens: number;
  heuristicTokens: number;
}

/** 压缩区间：待归档 head + 保留 tail */
export interface CompactableRange {
  headTurnIds: string[];
  headRouteTokens: number;
  headHeuristicTokens: number;
}

/**
 * 从尾部向前累计 route token 到 retainTokens 预算，head 为剩余 turn（对齐 deepseek selectCompactableRange 的 turn 粒度简化）。
 * summaryTokens 计入 head（旧摘要随增量折叠进新摘要）。
 * retainTokens <= 0 表示不保留尾部（context-overflow 强制压缩全部）；总 token 不足预算或 head 为空返回 null。
 */
export function selectCompactableRange(
  turns: TurnTokenBudget[],
  summaryTokens: number,
  retainTokens: number,
): CompactableRange | null {
  let tailStart = turns.length;
  if (retainTokens > 0) {
    let tailRoute = 0;
    for (let i = turns.length - 1; i >= 0; i--) {
      tailRoute += turns[i].routeTokens;
      if (tailRoute >= retainTokens) { tailStart = i; break; }
    }
    if (tailRoute < retainTokens) return null; // 尾部累计不足预算，全部保留
  }
  if (tailStart === 0) return null; // 无 head turn
  const head = turns.slice(0, tailStart);
  return {
    headTurnIds: head.map((t) => t.turnId),
    headRouteTokens: summaryTokens + head.reduce((s, t) => s + t.routeTokens, 0),
    headHeuristicTokens: head.reduce((s, t) => s + t.heuristicTokens, 0),
  };
}
