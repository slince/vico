// @vico/compaction - 压缩配置解析与区间选择（对齐 deepseek resolveCompactSpec / selectCompactableRange）

/** 压缩设置（字段语义对齐 deepseek BasicCompactionConfig） */
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
 * summarizationProvider/Model 成对。
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
  // 仅对显式传入的 retainRatio 校验：默认 retainRatio 不随 thresholdRatio 缩小而调整，避免误伤只改 thresholdRatio 的配置
  if (settings.retainRatio !== undefined && settings.retainRatio >= merged.thresholdRatio) {
    throw new Error('retainRatio must be less than thresholdRatio');
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
  tokens: number;
}

/** 压缩区间：待归档 head */
export interface CompactableRange {
  headTurnIds: string[];
  headTokens: number;
}

/**
 * 从尾部向前累计 token 到 retainTokens 预算，head 为剩余 turn（对齐 deepseek selectCompactableRange 的 turn 粒度简化）。
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
      tailRoute += turns[i].tokens;
      if (tailRoute >= retainTokens) { tailStart = i; break; }
    }
    if (tailRoute < retainTokens) return null; // 尾部累计不足预算，全部保留
  }
  if (tailStart === 0) return null; // 无 head turn
  const head = turns.slice(0, tailStart);
  return {
    headTurnIds: head.map((t) => t.turnId),
    headTokens: summaryTokens + head.reduce((s, t) => s + t.tokens, 0),
  };
}
