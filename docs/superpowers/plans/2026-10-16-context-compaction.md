# 上下文压缩（Context Compaction）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 Vico 的会话历史实现持久化、增量滚动、可主动触发的上下文压缩：历史过大时对已完成 turn 做结构化摘要，后续加载历史只读「摘要 + 最近尾部」，旧消息软归档。

**Architecture:** 对齐 deepseek-harness 的 capability seam——`ContextCompactor` 作为 core 端口 + `ModelContextCompactor` 默认实现，`LoopAgent` 作为 consumer 在 turn 边界触发 pressure 压缩、在模型报错时触发 context-overflow 压缩。判定口径（比例阈值 + 双 trigger）、token 估算（分 part 定价 + usage 锚定）、摘要（8 节 checkpoint 模板 + shrink check）全面对齐 spec。

**Tech Stack:** TypeScript ESM、AI SDK v4（`ModelMessage` / `LanguageModelV4StreamPart`）、vitest、Drizzle（libsql/mysql 适配器）、Hono。

**Spec:** [docs/superpowers/specs/2026-10-15-context-compaction-design.md](../specs/2026-10-15-context-compaction-design.md)

## Global Constraints

- 后端代码遵守 `docs/ts-server-best-practices.md`：路由层每个 handler 第一行 `getAuthContext(c)`、不做业务逻辑、不写 try-catch（异常自然冒泡）；ESM 导入带 `.js` 扩展名；避免 `any`（适配器既有 `as any` 沿用）。
- 注释要求：函数/方法/导出组件写 JSDoc，关键逻辑行写行注释，模块文件顶部写模块职责说明。
- 摘要消息持久化 `role='summary'`、`turnId=thread.id`（不属于任何 turn 的哨兵）；`metadata.kind='compaction-summary'`、`metadata.previousSummaryId` 指向前一版摘要。
- 落库顺序固定「先写后删」：先 `appendEntries` 新摘要，再 `archiveMessages` 归档旧摘要 + head 消息。
- 只压缩 `status='completed'` 的 turn；in-flight（running/paused/failed）turn 的消息绝不出现在候选集。
- 配置默认值（spec §5.1，逐字对齐）：`thresholdRatio=0.8`、`headroomTokens=65536`、`retainRatio=0.16`、`maxTokens=headroomTokens`、`compactionRetries=1`、`maxOverflowRetries=1`、`auto=true`。
- Token 常量（spec §7.1）：`CHARS_PER_TOKEN=4`、`BLOCK_OVERHEAD=4`、`ROLE_OVERHEAD=4`。
- 包管理器 pnpm + Turborepo；core 包名 `@vico/core`、适配器 `@vico/libsql-adapter` / `@vico/mysql-adapter`；测试用 vitest（core 的 `test` script = `vitest run`，include `src/**/*.test.ts`）。

## Review Focus

1. **摘要不小于被压缩内容（shrink check 失败）** — 必须回退「原文截断摘要」，且不归档、不写摘要；否则上下文越压越大且丢失信息。
2. **contextWindow 缺失时触发 pressure** — 抛 `TargetPressureConfigError`，LoopAgent 捕获后跳过并告警，turn 正常继续，绝不因此崩溃。
3. **摘要 LLM 失败或 abort** — 回退原文截断，不归档、不写摘要，主流程不阻塞。
4. **先写后删的崩溃安全** — 归档顺序颠倒（先删后写）会在中间态丢失历史；测试必须固定「追加新摘要 → 归档旧摘要 + head」顺序。
5. **摘要消息不污染 UI 与模型消息链** — `role='summary'` 在 `toUiMessages` 被静默跳过（前端全量展示旧消息不变）、在 `toModelMessages` 保持原样但由 `ConversationHistoryMemory` 转为 `role='system'` 前置、`getEntriesByTurns` 不会误取摘要（摘要 turnId 是 thread.id 哨兵）。

---

### Task 1: Token 估算器（token-estimator.ts）

**Files:**
- Create: `packages/core/src/agent/token-estimator.ts`
- Test: `packages/core/src/agent/token-estimator.test.ts`

**Interfaces:**
- Consumes: `ModelMessage`（`ai`）
- Produces:
  ```ts
  export const CHARS_PER_TOKEN = 4;
  export const BLOCK_OVERHEAD = 4;
  export const ROLE_OVERHEAD = 4;
  export interface TokenAnchor { pressureTokens: number; sampledSurfaceTokens: number }
  export interface PricedMessage { message: ModelMessage; tokens: number; heuristicTokens: number }
  export interface TokenMeasurement { totalTokens: number; surfaceTokens: number; heuristicTokens: number; nodes: PricedMessage[] }
  export function estimateContent(content: ModelMessage['content']): number
  export function estimateMessage(msg: ModelMessage): number
  export function measure(messages: ModelMessage[], anchor?: TokenAnchor): TokenMeasurement
  ```

- [ ] **Step 1: 写失败测试**

```ts
// packages/core/src/agent/token-estimator.test.ts
import { describe, expect, it } from 'vitest';
import type { ModelMessage } from 'ai';
import {
  BLOCK_OVERHEAD, CHARS_PER_TOKEN, ROLE_OVERHEAD,
  estimateContent, estimateMessage, measure,
} from './token-estimator.js';

describe('token-estimator', () => {
  it('纯文本 string content 按 chars/4 + block 开销计', () => {
    // "hello" = 5 chars → ceil(5/4)=2 + BLOCK_OVERHEAD
    expect(estimateContent('hello')).toBe(2 + BLOCK_OVERHEAD);
  });

  it('parts 数组逐 block 分派：text/reasoning/tool-call/未知', () => {
    const content: ModelMessage['content'] = [
      { type: 'text', text: 'hello' },
      { type: 'reasoning', text: 'thinking' },
      { type: 'tool-call', toolCallId: 'c1', toolName: 'read', input: { path: '/a/b' } },
      { type: 'tool-result', toolCallId: 'c1', toolName: 'read', output: { type: 'text', value: 'ok' } },
    ];
    const text = Math.ceil(5 / CHARS_PER_TOKEN) + BLOCK_OVERHEAD;
    const reasoning = Math.ceil(8 / CHARS_PER_TOKEN) + BLOCK_OVERHEAD;
    const toolCall = Math.ceil(4 / CHARS_PER_TOKEN) + Math.ceil(JSON.stringify({ path: '/a/b' }).length / CHARS_PER_TOKEN) + BLOCK_OVERHEAD;
    const toolResult = BLOCK_OVERHEAD + Math.ceil(JSON.stringify(content[3]).length / CHARS_PER_TOKEN);
    expect(estimateContent(content)).toBe(text + reasoning + toolCall + toolResult);
  });

  it('estimateMessage 对非 system 加 ROLE_OVERHEAD', () => {
    expect(estimateMessage({ role: 'user', content: 'hello' })).toBe(estimateContent('hello') + ROLE_OVERHEAD);
  });

  it('estimateMessage 对 system 走纯文本密度 + ROLE_OVERHEAD（无 per-block）', () => {
    const msg: ModelMessage = { role: 'system', content: [{ type: 'text', text: 'sys' }] };
    // system：直接对文本长度估，不加 block 开销
    expect(estimateMessage(msg)).toBe(Math.ceil(3 / CHARS_PER_TOKEN) + ROLE_OVERHEAD);
  });

  it('measure 无 anchor 时 totalTokens = surfaceTokens', () => {
    const m = measure([{ role: 'user', content: 'hello' }]);
    expect(m.totalTokens).toBe(m.surfaceTokens);
    expect(m.nodes).toHaveLength(1);
    expect(m.nodes[0].tokens).toBe(m.nodes[0].heuristicTokens); // v1 route = heuristic
  });

  it('measure 有 anchor 时 totalTokens = max(0, pressure + surface - sampled)', () => {
    const m = measure(
      [{ role: 'user', content: 'hello' }],
      { pressureTokens: 1000, sampledSurfaceTokens: 800 },
    );
    expect(m.totalTokens).toBe(1000 + m.surfaceTokens - 800);
  });

  it('measure anchor 使投影为负时取 0', () => {
    const m = measure(
      [{ role: 'user', content: 'hello' }],
      { pressureTokens: 10, sampledSurfaceTokens: 800 },
    );
    expect(m.totalTokens).toBe(0);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @vico/core exec vitest run src/agent/token-estimator.test.ts`
Expected: FAIL — 模块不存在。

- [ ] **Step 3: 实现**

```ts
// @vico/core - Token 估算：分 part 定价 + ROLE/BLOCK 开销 + usage 锚定（对齐 deepseek dsh-token-meter）
import type {ModelMessage} from 'ai';
import {getMessageText} from '../model/message-utils.js';

/** 每 token 对应字符数（固定启发式） */
export const CHARS_PER_TOKEN = 4;
/** 每个 content block 的 JSON 结构/类型标签开销 */
export const BLOCK_OVERHEAD = 4;
/** 每条消息 role 字段框架开销 */
export const ROLE_OVERHEAD = 4;

/** usage 锚定输入：最近 provider 上报 prompt token 与采样时 surface 快照 */
export interface TokenAnchor {
  pressureTokens: number;
  sampledSurfaceTokens: number;
}

/** 单条消息的双级价格 */
export interface PricedMessage {
  message: ModelMessage;
  /** route-priced 价格（判定/切分/shrink 用；v1 纯文本 === heuristic） */
  tokens: number;
  /** 固定启发式价格（替换记账 shadow-price 用） */
  heuristicTokens: number;
}

/** 测量结果 */
export interface TokenMeasurement {
  /** usage 锚定后的投影 token；无 anchor 时 = surfaceTokens */
  totalTokens: number;
  /** Σ route-priced token */
  surfaceTokens: number;
  /** Σ heuristic token */
  heuristicTokens: number;
  nodes: PricedMessage[];
}

/**
 * 估算 content（string 或 parts 数组）的 token 数。
 * text/reasoning → 文本密度 + block 开销；tool-call → 名 + 参数 + block 开销；其它 → JSON 密度 + block 开销。
 */
export function estimateContent(content: ModelMessage['content']): number {
  if (typeof content === 'string') {
    return Math.ceil(content.length / CHARS_PER_TOKEN) + BLOCK_OVERHEAD;
  }
  let total = 0;
  for (const block of content) {
    switch (block.type) {
      case 'text':
      case 'reasoning':
        total += Math.ceil(((block as { text?: string }).text?.length ?? 0) / CHARS_PER_TOKEN) + BLOCK_OVERHEAD;
        break;
      case 'tool-call': {
        const tc = block as { toolName?: string; input?: unknown };
        total += Math.ceil((tc.toolName?.length ?? 0) / CHARS_PER_TOKEN)
          + Math.ceil(JSON.stringify(tc.input ?? {}).length / CHARS_PER_TOKEN)
          + BLOCK_OVERHEAD;
        break;
      }
      default:
        total += BLOCK_OVERHEAD + Math.ceil(JSON.stringify(block).length / CHARS_PER_TOKEN);
    }
  }
  return total;
}

/** system 消息按纯文本密度 + ROLE_OVERHEAD 估（无 per-block 开销，对齐 deepseek estimateSystemMessage） */
function estimateSystemMessage(msg: ModelMessage): number {
  return Math.ceil(getMessageText(msg).length / CHARS_PER_TOKEN) + ROLE_OVERHEAD;
}

/** 单条消息估算：system 特殊处理，其它 content + ROLE_OVERHEAD */
export function estimateMessage(msg: ModelMessage): number {
  if (msg.role === 'system') return estimateSystemMessage(msg);
  return estimateContent(msg.content) + ROLE_OVERHEAD;
}

/** 批量测量：v1 无图片/文件，route 价格 = heuristic；有 anchor 时做 usage 投影 */
export function measure(messages: ModelMessage[], anchor?: TokenAnchor): TokenMeasurement {
  const nodes: PricedMessage[] = messages.map((message) => {
    const heuristicTokens = estimateMessage(message);
    return { message, tokens: heuristicTokens, heuristicTokens };
  });
  const surfaceTokens = nodes.reduce((s, n) => s + n.tokens, 0);
  const heuristicTokens = nodes.reduce((s, n) => s + n.heuristicTokens, 0);
  const totalTokens = anchor
    ? Math.max(0, anchor.pressureTokens + surfaceTokens - anchor.sampledSurfaceTokens)
    : surfaceTokens;
  return { totalTokens, surfaceTokens, heuristicTokens, nodes };
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter @vico/core exec vitest run src/agent/token-estimator.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add packages/core/src/agent/token-estimator.ts packages/core/src/agent/token-estimator.test.ts
git commit -m "feat(core): token 估算器（分 part 定价 + usage 锚定）"
```

---

### Task 2: 压缩配置解析与区间选择（compaction-config.ts）

**Files:**
- Create: `packages/core/src/agent/compaction-config.ts`
- Test: `packages/core/src/agent/compaction-config.test.ts`

**Interfaces:**
- Consumes: 无
- Produces:
  ```ts
  export interface CompactionSettings { auto?, thresholdRatio?, headroomTokens?, retainRatio?, retainTokens?, summarizationProvider?, summarizationModel?, maxTokens?, compactionRetries?, maxOverflowRetries?, modelPolicies?: CompactionModelPolicy[] }
  export interface CompactionModelPolicy { provider: string; model: string; thresholdRatio?, headroomTokens?, retainRatio?, retainTokens?, summarizationProvider?, summarizationModel?, maxTokens?, compactionRetries?, maxOverflowRetries? }
  export interface ResolvedCompactionSettings { auto: boolean; thresholdRatio: number; headroomTokens: number; retainRatio: number; retainTokens?: number; summarizationProvider?: string; summarizationModel?: string; maxTokens: number; compactionRetries: number; maxOverflowRetries: number; modelPolicies?: CompactionModelPolicy[] }
  export interface ResolvedCompactSpec { messageBudgetTokens: number; pressureBudgetTokens: number; thresholdTokens: number; retainTokens: number; headroomTokens: number; maxTokens: number }
  export const DEFAULT_COMPACTION_SETTINGS: ResolvedCompactionSettings
  export function resolveSettings(settings?: Partial<CompactionSettings>): ResolvedCompactionSettings
  export function resolveCompactSpec(settings: ResolvedCompactionSettings, contextWindow: number, reservedCompletionTokens: number): ResolvedCompactSpec
  export interface TurnTokenBudget { turnId: string; routeTokens: number; heuristicTokens: number }
  export interface CompactableRange { headTurnIds: string[]; headRouteTokens: number; headHeuristicTokens: number }
  export function selectCompactableRange(turns: TurnTokenBudget[], summaryTokens: number, retainTokens: number): CompactableRange | null
  ```

- [ ] **Step 1: 写失败测试**

```ts
// packages/core/src/agent/compaction-config.test.ts
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_COMPACTION_SETTINGS,
  resolveCompactSpec, resolveSettings, selectCompactableRange,
} from './compaction-config.js';

describe('resolveSettings', () => {
  it('未传时返回默认值', () => {
    expect(resolveSettings(undefined)).toEqual(DEFAULT_COMPACTION_SETTINGS);
  });

  it('retainRatio 与 retainTokens 互斥报错', () => {
    expect(() => resolveSettings({ retainRatio: 0.1, retainTokens: 8000 })).toThrow(/mutually exclusive|互斥/);
  });

  it('retainRatio >= thresholdRatio 报错', () => {
    expect(() => resolveSettings({ thresholdRatio: 0.5, retainRatio: 0.6 })).toThrow(/retainRatio/);
  });

  it('summarizationProvider/Model 必须成对设置', () => {
    expect(() => resolveSettings({ summarizationProvider: 'openai' })).toThrow(/summarization/);
  });

  it('modelPolicies 重复 target 报错', () => {
    expect(() => resolveSettings({ modelPolicies: [
      { provider: 'a', model: 'm' },
      { provider: 'a', model: 'm' },
    ] })).toThrow(/duplicate|重复/);
  });

  it('默认 maxTokens = headroomTokens', () => {
    expect(resolveSettings({ headroomTokens: 100 }).maxTokens).toBe(100);
  });
});

describe('resolveCompactSpec', () => {
  it('按公式解析预算', () => {
    const spec = resolveCompactSpec(resolveSettings(), 200000, 4096);
    expect(spec.messageBudgetTokens).toBe(200000 - 4096);
    expect(spec.pressureBudgetTokens).toBe(200000 - 4096 - 65536);
    expect(spec.thresholdTokens).toBe(Math.floor(Math.min(200000 * 0.8, 200000 - 4096 - 65536)));
    expect(spec.retainTokens).toBe(Math.floor((200000 - 4096) * 0.16));
    expect(spec.maxTokens).toBe(65536);
  });

  it('显式 retainTokens 覆盖 retainRatio', () => {
    const spec = resolveCompactSpec(resolveSettings({ retainTokens: 8000 }), 200000, 0);
    expect(spec.retainTokens).toBe(8000);
  });

  it('pressureBudgetTokens <= 0 报错', () => {
    expect(() => resolveCompactSpec(resolveSettings(), 70000, 0)).toThrow(/pressure/);
  });
});

describe('selectCompactableRange', () => {
  const turns = [
    { turnId: 't1', routeTokens: 100, heuristicTokens: 90 },
    { turnId: 't2', routeTokens: 200, heuristicTokens: 180 },
    { turnId: 't3', routeTokens: 300, heuristicTokens: 270 },
  ];

  it('从尾部累计到 retainTokens，head = 剩余 turn', () => {
    const r = selectCompactableRange(turns, 50, 350);
    expect(r!.headTurnIds).toEqual(['t1', 't2']);
    expect(r!.headRouteTokens).toBe(50 + 100 + 200);
    expect(r!.headHeuristicTokens).toBe(90 + 180);
  });

  it('总 token 不足 retainTokens 时返回 null（全部保留）', () => {
    expect(selectCompactableRange(turns, 50, 1000)).toBeNull();
  });

  it('retainTokens=0 时压缩全部 turn（head = 全部）', () => {
    const r = selectCompactableRange(turns, 50, 0);
    expect(r!.headTurnIds).toEqual(['t1', 't2', 't3']);
  });

  it('head 为空时返回 null', () => {
    expect(selectCompactableRange([], 50, 0)).toBeNull();
    // retainTokens 很小但只有一个 turn：tailStart 会落在 0 → null
    expect(selectCompactableRange([{ turnId: 't1', routeTokens: 100, heuristicTokens: 90 }], 0, 10)).toBeNull();
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @vico/core exec vitest run src/agent/compaction-config.test.ts`
Expected: FAIL。

- [ ] **Step 3: 实现**

```ts
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
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter @vico/core exec vitest run src/agent/compaction-config.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add packages/core/src/agent/compaction-config.ts packages/core/src/agent/compaction-config.test.ts
git commit -m "feat(core): 压缩配置解析（resolveSettings/resolveCompactSpec/selectCompactableRange）"
```

---

### Task 3: ThreadStore 端口扩展（archived + archiveMessages + includeArchived）

**Files:**
- Modify: `packages/core/src/thread/thread-store.ts`（`Message` + `ThreadStore` 接口）
- Modify: `packages/core/src/thread/memory-thread-store.ts`（InMemory 实现）
- Test: `packages/core/src/thread/memory-thread-store.test.ts`（追加 describe）

**Interfaces:**
- Consumes: 无
- Produces:
  ```ts
  // Message 新增可选字段
  interface Message { /* ...existing */ archived?: boolean }
  // ThreadStore 变更
  getEntries(threadId, options?: { limit?, start?, roles?, includeArchived?: boolean }): Promise<Message[]>
  getEntriesByTurns(turnIds: string[], options?: { includeArchived?: boolean }): Promise<Message[]>
  archiveMessages(threadId: string, messageIds: string[]): Promise<void>
  ```

- [ ] **Step 1: 写失败测试（追加到 memory-thread-store.test.ts）**

```ts
// packages/core/src/thread/memory-thread-store.test.ts 追加
import { describe, expect, it } from 'vitest';
import { InMemoryThreadStore } from './memory-thread-store.js';

describe('InMemoryThreadStore.archiveMessages / includeArchived', () => {
  it('archiveMessages 软标记消息；getEntries 默认含归档、includeArchived:false 排除', async () => {
    const store = new InMemoryThreadStore();
    await store.createThread('a', 't', 'thread-1');
    const [m1, m2] = await store.appendEntries([
      { threadId: 'thread-1', turnId: 'turn-1', role: 'user', content: '"hi"' },
      { threadId: 'thread-1', turnId: 'turn-1', role: 'assistant', content: '"yo"' },
    ]);

    await store.archiveMessages('thread-1', [m1.id]);

    const all = await store.getEntries('thread-1');
    expect(all.map((m) => m.id)).toEqual([m1.id, m2.id]);
    expect(all[0].archived).toBe(true);

    const active = await store.getEntries('thread-1', { includeArchived: false });
    expect(active.map((m) => m.id)).toEqual([m2.id]);
  });

  it('getEntriesByTurns 支持 includeArchived 过滤', async () => {
    const store = new InMemoryThreadStore();
    await store.createThread('a', 't', 'thread-1');
    const [m1, m2] = await store.appendEntries([
      { threadId: 'thread-1', turnId: 'turn-1', role: 'user', content: '"hi"' },
      { threadId: 'thread-1', turnId: 'turn-1', role: 'assistant', content: '"yo"' },
    ]);
    await store.archiveMessages('thread-1', [m1.id]);

    const active = await store.getEntriesByTurns(['turn-1'], { includeArchived: false });
    expect(active.map((m) => m.id)).toEqual([m2.id]);
  });

  it('archiveMessages 幂等且忽略不存在的 id', async () => {
    const store = new InMemoryThreadStore();
    await store.createThread('a', 't', 'thread-1');
    const [m1] = await store.appendEntries([
      { threadId: 'thread-1', turnId: 'turn-1', role: 'user', content: '"hi"' },
    ]);
    await store.archiveMessages('thread-1', [m1.id, 'nope']);
    await store.archiveMessages('thread-1', [m1.id]);
    const active = await store.getEntries('thread-1', { includeArchived: false });
    expect(active).toHaveLength(0);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @vico/core exec vitest run src/thread/memory-thread-store.test.ts`
Expected: FAIL（`archiveMessages` 不存在、`includeArchived` 未实现）。

- [ ] **Step 3: 实现端口 + InMemory**

`thread-store.ts` 修改 `Message`（在 `createdAt` 前加字段）与 `ThreadStore` 两个方法签名：

```ts
/** 对话记录条目 — content 存原生 ModelMessage.content 的 JSON 序列化（string 或 parts 数组） */
export interface Message {
  id: string;
  threadId: string;
  turnId: string;
  role: string;
  content: string;
  metadata?: MessageMetadata;
  /** 是否已被压缩归档（模型上下文不再读取；UI 仍全量展示） */
  archived?: boolean;
  createdAt: number;
}
```

```ts
  /** 获取线程的对话记录列表（支持分页、角色筛选、归档过滤） */
  getEntries(threadId: string, options?: { limit?: number; start?: number; roles?: string[]; includeArchived?: boolean }): Promise<Message[]>;
  /** 批量获取多个 turn 的对话记录（可选排除已归档） */
  getEntriesByTurns(turnIds: string[], options?: { includeArchived?: boolean }): Promise<Message[]>;
  /** 批量归档消息（软标记 archived=true），只作用于已完成 turn 的消息 */
  archiveMessages(threadId: string, messageIds: string[]): Promise<void>;
```

`memory-thread-store.ts` 追加实现：

```ts
  async getEntries(threadId: string, options?: { limit?: number; start?: number; roles?: string[]; includeArchived?: boolean }): Promise<Message[]> {
    let list = this.messages.get(threadId) ?? [];
    if (options?.roles?.length) {
      const roleSet = new Set(options.roles);
      list = list.filter((m) => roleSet.has(m.role));
    }
    if (options?.includeArchived === false) {
      list = list.filter((m) => !m.archived);
    }
    const start = options?.start ?? 0;
    const end = options?.limit ? start + options.limit : undefined;
    return [...list].slice(start, end);
  }

  async getEntriesByTurns(turnIds: string[], options?: { includeArchived?: boolean }): Promise<Message[]> {
    if (turnIds.length === 0) return [];
    const ids = new Set(turnIds);
    const all: Message[] = [];
    for (const list of this.messages.values()) {
      for (const m of list) {
        if (ids.has(m.turnId) && !(options?.includeArchived === false && m.archived)) all.push(m);
      }
    }
    all.sort((a, b) => a.createdAt - b.createdAt);
    return all;
  }

  async archiveMessages(threadId: string, messageIds: string[]): Promise<void> {
    const list = this.messages.get(threadId);
    if (!list || messageIds.length === 0) return;
    const ids = new Set(messageIds);
    for (const m of list) {
      if (ids.has(m.id)) m.archived = true;
    }
  }
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter @vico/core exec vitest run src/thread/memory-thread-store.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add packages/core/src/thread/thread-store.ts packages/core/src/thread/memory-thread-store.ts packages/core/src/thread/memory-thread-store.test.ts
git commit -m "feat(core): ThreadStore 增加 archived 字段与 archiveMessages/includeArchived"
```

---

### Task 4: ContextCompactor 重写（context-compactor.ts）

**Files:**
- Rewrite: `packages/core/src/agent/context-compactor.ts`
- Test: `packages/core/src/agent/context-compactor.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `measure`/`PricedMessage`；Task 2 的 `resolveSettings`/`resolveCompactSpec`/`selectCompactableRange`；Task 3 的 `ThreadStore`（`getEntries`/`getRecentTurns`/`getEntriesByTurns`/`appendEntries`/`archiveMessages`）；`KeyedMutex`（`../utils/async-keyed-lock.js`）；`ModelClient`（`../model/model-client.js`）；`createLanguageModel`（`../model/factory.js`）；`ModelConfig`（`./types.js`）；`toModelMessages`（`../thread/utils.js`）；`getMessageText`（`../model/message-utils.js`）
- Produces（`packages/core/src/index.ts` 导出）:
  ```ts
  export type CompactionTrigger = 'pressure' | 'context-overflow'
  export type ManualCompactionErrorCode = 'busy' | 'cancelled' | 'changed' | 'summary' | 'commit' | 'persistence'
  export class ManualCompactionError extends Error { constructor(readonly code: ManualCompactionErrorCode, message: string, options?: ErrorOptions) }
  export class TargetPressureConfigError extends Error
  export interface CompactionResult { summaryMessageId: string; archivedTurnIds: string[]; shadowedRange: { startTurnId: string; endTurnId: string }; shadowedTokenCount: number; removedTokens: number }
  export interface ContextCompactor { compactIfNeeded(thread, modelClient, trigger, signal): Promise<CompactionResult|null>; compactNow(thread, modelClient, signal): Promise<CompactionResult|null>; recordUsage(threadId, pressureTokens): void; noteModelSuccess(thread): void }
  export interface ModelContextCompactorOptions { thread: ThreadStore; conversationWindow: number; modelConfig?: ModelConfig; maxTokens?: number; settings?: Partial<CompactionSettings> }
  export class ModelContextCompactor implements ContextCompactor
  export function isContextOverflowError(error: unknown): boolean
  ```

- [ ] **Step 1: 写失败测试**

```ts
// packages/core/src/agent/context-compactor.test.ts
import { describe, expect, it, vi } from 'vitest';
import { InMemoryThreadStore } from '../thread/memory-thread-store.js';
import type { ModelClient } from '../model/model-client.js';
import { ModelContextCompactor, TargetPressureConfigError, isContextOverflowError } from './context-compactor.js';

/** 摘要返回 "compacted summary text" 的假 ModelClient */
function fakeClient(): ModelClient {
  return {
    stream: vi.fn(async () => {
      const parts = [{ type: 'text-delta', delta: 'compacted summary text' }];
      return { stream: ReadableStream.from(parts), readText: async () => 'compacted summary text' };
    }),
  } as unknown as ModelClient;
}

/** 造一个 thread + 若干 completed turn（每条一条长文本 user 消息，保证 head token 足够大以通过 shrink check） */
async function seed(store: InMemoryThreadStore, texts: string[]): Promise<void> {
  await store.createThread('agent', 't', 'thread-1');
  for (const text of texts) {
    const turn = await store.createTurn('thread-1');
    await store.appendEntries([{ threadId: 'thread-1', turnId: turn.id, role: 'user', content: JSON.stringify(text) }]);
    await store.updateTurn(turn.id, { status: 'completed' });
  }
}

describe('isContextOverflowError', () => {
  it('匹配典型超限错误', () => {
    expect(isContextOverflowError(new Error('maximum context length exceeded'))).toBe(true);
    expect(isContextOverflowError(new Error('context_length_exceeded'))).toBe(true);
    expect(isContextOverflowError({ statusCode: 400, message: 'context length' })).toBe(true);
    expect(isContextOverflowError(new Error('network error'))).toBe(false);
  });
});

describe('ModelContextCompactor', () => {
  it('pressure 无 contextWindow 时抛 TargetPressureConfigError', async () => {
    const store = new InMemoryThreadStore();
    await seed(store, ['hello']);
    const c = new ModelContextCompactor({ thread: store, conversationWindow: 10 });
    await expect(c.compactIfNeeded(
      (await store.getThread('thread-1'))!,
      fakeClient(),
      'pressure',
      new AbortController().signal,
    )).rejects.toThrow(TargetPressureConfigError);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @vico/core exec vitest run src/agent/context-compactor.test.ts`
Expected: FAIL（`context-compactor.ts` 仍是旧的死代码 `ContextCompactor` 类）。

- [ ] **Step 3: 重写 context-compactor.ts**

```ts
// @vico/core - ContextCompactor 端口 + ModelContextCompactor 默认实现（持久化增量滚动压缩）
import {randomUUID} from 'node:crypto';
import type {ModelMessage} from 'ai';
import type {Thread, ThreadStore} from '../thread/thread-store.js';
import {ModelClient} from '../model/model-client.js';
import {createLanguageModel} from '../model/factory.js';
import type {ModelConfig} from './types.js';
import {toModelMessages} from '../thread/utils.js';
import {getMessageText} from '../model/message-utils.js';
import {KeyedMutex} from '../utils/async-keyed-lock.js';
import {measure, estimateMessage} from './token-estimator.js';
import {
  resolveSettings, resolveCompactSpec, selectCompactableRange,
  type CompactionSettings, type ResolvedCompactionSettings,
} from './compaction-config.js';

/** 压缩触发类型：pressure（窗口压力）/ context-overflow（模型报错超限） */
export type CompactionTrigger = 'pressure' | 'context-overflow';

/** 手动压缩失败分类（对齐 ManualCompactionErrorCode） */
export type ManualCompactionErrorCode = 'busy' | 'cancelled' | 'changed' | 'summary' | 'commit' | 'persistence';

export class ManualCompactionError extends Error {
  constructor(readonly code: ManualCompactionErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ManualCompactionError';
  }
}

/** pressure 触发但未配置 contextWindow 时抛出（对齐 deepseek TargetPressureConfigError） */
export class TargetPressureConfigError extends Error {
  constructor() {
    super('contextWindow is required for pressure-triggered compaction');
    this.name = 'TargetPressureConfigError';
  }
}

/** 压缩结果 */
export interface CompactionResult {
  summaryMessageId: string;
  archivedTurnIds: string[];
  shadowedRange: { startTurnId: string; endTurnId: string };
  shadowedTokenCount: number;
  removedTokens: number;
}

/** 上下文压缩端口（对齐 deepseek CompactionEngine） */
export interface ContextCompactor {
  compactIfNeeded(thread: Thread, modelClient: ModelClient, trigger: CompactionTrigger, signal: AbortSignal): Promise<CompactionResult | null>;
  compactNow(thread: Thread, modelClient: ModelClient, signal: AbortSignal): Promise<CompactionResult | null>;
  recordUsage(threadId: string, pressureTokens: number): void;
  /** 任一 turn 收到正常 assistant 消息时调用，清零 context-overflow 重试计数 */
  noteModelSuccess(thread: Thread): void;
}

/** ModelContextCompactor 构造选项 */
export interface ModelContextCompactorOptions {
  thread: ThreadStore;
  /** 候选 surface 的最近已完成 turn 数（对齐 stm_window） */
  conversationWindow: number;
  /** agent 原始模型配置（contextWindow + 独立摘要模型解析） */
  modelConfig?: ModelConfig;
  /** agent 输出上限（reservedCompletionTokens） */
  maxTokens?: number;
  settings?: Partial<CompactionSettings>;
}

/** 摘要消息固定 role 与 metadata 标识 */
const SUMMARY_ROLE = 'summary';
const SUMMARY_METADATA_KIND = 'compaction-summary';

/** 结构化 checkpoint 指令（对齐 deepseek COMPACTION_INSTRUCTION 8 节模板） */
export const COMPACTION_INSTRUCTION = `You are maintaining a rolling summary of an ongoing conversation between an AI agent and a user.
Compress the provided conversation content into a structured Markdown checkpoint. Rules:
- Preserve each of the following 8 sections verbatim (use "(none)" for empty sections):
  ## Primary Request and Intent
  ## Key Technical Concepts
  ## Files and Code
  ## Errors and Fixes
  ## Pending Jobs
  ## Current Work
  ## Next Step
  ## Critical Context
- Use concise bullets. Preserve exact paths, commands, error strings, identifiers, numeric values, and function signatures.
- Faithfully record user feedback and corrections. Do not mention this compaction.
- If a previous summary block is present in the input, merge with it rather than copy it verbatim.`;

export const CHECKPOINT_PREAMBLE = 'This is an automatically generated compacted summary of earlier conversation content.';
export const SUMMARY_OPEN_TAG = '<compacted-summary>';
export const SUMMARY_CLOSE_TAG = '</compacted-summary>';

/** 上下文超限启发式检测（对齐 deepseek CONTEXT_WINDOW_EXCEEDED_CODE 的 Vico 侧适配） */
export function isContextOverflowError(error: unknown): boolean {
  const text = (typeof error === 'string' ? error : '') + ' '
    + ((error as { message?: string } | null)?.message ?? '') + ' '
    + String((error as { statusCode?: number } | null)?.statusCode ?? '');
  return /context.?length|context_length_exceeded|maximum context|too many tokens|token limit|context window/i.test(text);
}

/** 摘要消息 framing */
function frameSummary(text: string): string {
  return `${CHECKPOINT_PREAMBLE}\n\n${SUMMARY_OPEN_TAG}\n${text}\n${SUMMARY_CLOSE_TAG}`;
}

/** 失败回退：原文截断摘要（head 各消息 role + 前 200 字符） */
function fallbackSummary(head: ModelMessage[]): string {
  return head.map((m) => `${m.role}: ${getMessageText(m).slice(0, 200)}`).join('\n');
}

/** 候选 surface 段：摘要（可空）+ 各已完成 turn 消息 */
interface CandidateTurn { turnId: string; messages: ModelMessage[]; messageIds: string[] }
interface Candidate {
  summary: ModelMessage | null;
  summaryEntryId?: string;
  turns: CandidateTurn[];
}

/**
 * 持久化增量滚动压缩器。
 * 只压缩 status='completed' 的 turn；append-only（先写摘要后归档）；per-thread KeyedMutex 互斥。
 */
export class ModelContextCompactor implements ContextCompactor {
  private readonly thread: ThreadStore;
  private readonly conversationWindow: number;
  private readonly modelConfig?: ModelConfig;
  private readonly reservedCompletionTokens: number;
  private readonly settings: ResolvedCompactionSettings;

  private readonly locks = new KeyedMutex();
  private readonly busyThreads = new Set<string>();
  private readonly pressureTokens = new Map<string, number>();
  private readonly sampledSurfaceTokens = new Map<string, number>();
  private readonly overflowRetries = new WeakMap<Thread, number>();

  constructor(options: ModelContextCompactorOptions) {
    this.thread = options.thread;
    this.conversationWindow = options.conversationWindow;
    this.modelConfig = options.modelConfig;
    this.reservedCompletionTokens = options.maxTokens ?? 0;
    this.settings = resolveSettings(options.settings);
  }

  recordUsage(threadId: string, pressureTokens: number): void {
    this.pressureTokens.set(threadId, pressureTokens);
  }

  noteModelSuccess(thread: Thread): void {
    this.overflowRetries.delete(thread);
  }

  async compactIfNeeded(thread: Thread, modelClient: ModelClient, trigger: CompactionTrigger, signal: AbortSignal): Promise<CompactionResult | null> {
    if (!this.settings.auto) return null;
    if (trigger === 'context-overflow') {
      const r = this.overflowRetries.get(thread) ?? 0;
      if (r >= this.settings.maxOverflowRetries) return null; // 超限，不再重试
    }
    return this.locks.run(thread.id, () => this.compactLocked(thread, modelClient, trigger, signal));
  }

  async compactNow(thread: Thread, modelClient: ModelClient, signal: AbortSignal): Promise<CompactionResult | null> {
    if (this.busyThreads.has(thread.id)) {
      throw new ManualCompactionError('busy', `compaction already in progress for thread ${thread.id}`);
    }
    return this.locks.run(thread.id, () => this.compactLocked(thread, modelClient, 'pressure', signal, { skipThreshold: true }));
  }

  // ── 内部 ──

  /** 锁内主流程（pressure / context-overflow / compactNow 共用） */
  private async compactLocked(thread: Thread, modelClient: ModelClient, trigger: CompactionTrigger, signal: AbortSignal, opts: { skipThreshold?: boolean } = {}): Promise<CompactionResult | null> {
    this.busyThreads.add(thread.id);
    try {
      const candidate = await this.loadCandidate(thread);
      if (candidate.turns.length === 0) return null;

      const { retainTokens, thresholdTokens } = this.resolveSpec(trigger);
      const allMessages = [
        ...(candidate.summary ? [candidate.summary] : []),
        ...candidate.turns.flatMap((t) => t.messages),
      ];
      const anchor = this.pressureTokens.has(thread.id)
        ? { pressureTokens: this.pressureTokens.get(thread.id)!, sampledSurfaceTokens: this.sampledSurfaceTokens.get(thread.id) ?? 0 }
        : undefined;
      const measurement = measure(allMessages, anchor);
      this.sampledSurfaceTokens.set(thread.id, measurement.surfaceTokens);

      // pressure（非 compactNow）阈值判定
      if (!opts.skipThreshold && trigger === 'pressure' && measurement.totalTokens < thresholdTokens) {
        return null;
      }

      const range = selectCompactableRange(
        candidate.turns.map((t) => {
          const tokens = measure(t.messages);
          return { turnId: t.turnId, routeTokens: tokens.surfaceTokens, heuristicTokens: tokens.heuristicTokens };
        }),
        candidate.summary ? estimateMessage(candidate.summary) : 0,
        retainTokens,
      );
      if (!range) return null;

      const headTurns = candidate.turns.filter((t) => range.headTurnIds.includes(t.turnId));
      const headMessages = headTurns.flatMap((t) => t.messages);
      const headMessageIds = headTurns.flatMap((t) => t.messageIds);

      // 增量摘要（含 shrink check 与失败回退）
      const summaryText = await this.summarize(headMessages, candidate.summary, modelClient, signal);
      if (signal.aborted) return null; // cancelled

      // append-only 落库：先写新摘要，再归档旧摘要 + head（先写后删，崩溃不丢上下文）
      const summaryMessageId = randomUUID();
      const summaryEntry = {
        threadId: thread.id,
        turnId: thread.id, // 摘要不属于任何 turn，用 thread.id 作哨兵
        role: SUMMARY_ROLE,
        content: JSON.stringify(summaryText),
        metadata: {
          kind: SUMMARY_METADATA_KIND,
          ...(candidate.summaryEntryId ? { previousSummaryId: candidate.summaryEntryId } : {}),
        },
      };
      const [created] = await this.thread.appendEntries([summaryEntry]);
      await this.thread.archiveMessages(thread.id, [
        ...(candidate.summaryEntryId ? [candidate.summaryEntryId] : []),
        ...headMessageIds,
      ]);

      if (trigger === 'context-overflow') {
        this.overflowRetries.set(thread, (this.overflowRetries.get(thread) ?? 0) + 1);
      }

      return {
        summaryMessageId: created.id,
        archivedTurnIds: range.headTurnIds,
        shadowedRange: { startTurnId: range.headTurnIds[0], endTurnId: range.headTurnIds[range.headTurnIds.length - 1] },
        shadowedTokenCount: range.headHeuristicTokens,
        removedTokens: range.headRouteTokens,
      };
    } finally {
      this.busyThreads.delete(thread.id);
    }
  }

  /** 解析 retainTokens / thresholdTokens（context-overflow 强制 retainTokens=0，bypass 阈值） */
  private resolveSpec(trigger: CompactionTrigger): { retainTokens: number; thresholdTokens: number } {
    if (trigger === 'context-overflow') {
      return { retainTokens: 0, thresholdTokens: 0 };
    }
    if (this.modelConfig?.contextWindow === undefined) {
      throw new TargetPressureConfigError();
    }
    const spec = resolveCompactSpec(this.settings, this.modelConfig.contextWindow, this.reservedCompletionTokens);
    return { retainTokens: spec.retainTokens, thresholdTokens: spec.thresholdTokens };
  }

  /** 读候选 surface：最新非归档摘要 + 最近 conversationWindow 个已完成 turn 的非归档消息 */
  private async loadCandidate(thread: Thread): Promise<Candidate> {
    const summaryEntries = await this.thread.getEntries(thread.id, { roles: [SUMMARY_ROLE], includeArchived: false });
    const summary = summaryEntries.length > 0 ? toModelMessages([summaryEntries[summaryEntries.length - 1]])[0] : null;

    const recent = await this.thread.getRecentTurns(thread.id, this.conversationWindow, 'completed');
    const ordered = [...recent].reverse(); // 升序（最旧在前）
    const entries = ordered.length > 0
      ? await this.thread.getEntriesByTurns(ordered.map((t) => t.id), { includeArchived: false })
      : [];

    const byTurn = new Map<string, CandidateTurn>();
    for (const t of ordered) byTurn.set(t.id, { turnId: t.id, messages: [], messageIds: [] });
    for (const e of entries) {
      const g = byTurn.get(e.turnId);
      if (!g) continue;
      g.messages.push(toModelMessages([e])[0]);
      g.messageIds.push(e.id);
    }
    const turns = ordered.filter((t) => byTurn.get(t.id)!.messages.length > 0).map((t) => byTurn.get(t.id)!);

    return { summary, summaryEntryId: summaryEntries[summaryEntries.length - 1]?.id, turns };
  }

  /** 增量摘要：独立摘要模型（若配置）或复用传入 modelClient；失败重试 compactionRetries 次后回退原文截断；shrink check 失败走回退 */
  private async summarize(head: ModelMessage[], oldSummary: ModelMessage | null, modelClient: ModelClient, signal: AbortSignal): Promise<string> {
    const client = this.resolveSummaryClient(modelClient);
    const headRouteTokens = measure(head).surfaceTokens;

    // 摘要输入：旧摘要折叠进新摘要（以 system 角色传入——summary 非 provider 可识别角色，避免 standardizePrompt 拒绝）
    const input: ModelMessage[] = [];
    if (oldSummary) input.push({ role: 'system', content: getMessageText(oldSummary) });
    input.push(...head);

    // 摘要调用按 compactionRetries 重试，全部失败后回退原文截断
    let text = '';
    for (let attempt = 0; attempt <= this.settings.compactionRetries; attempt++) {
      try {
        const { stream } = await client.stream({
          system: COMPACTION_INSTRUCTION,
          messages: input,
          maxOutputTokens: this.settings.maxTokens,
          temperature: 0,
          abortSignal: signal,
        });
        text = '';
        for await (const part of stream) {
          if (part.type === 'text-delta') text += (part as { delta?: string }).delta ?? '';
        }
        break; // 成功，退出重试
      } catch {
        if (attempt === this.settings.compactionRetries) text = fallbackSummary(head);
      }
    }

    if (!text.trim()) text = fallbackSummary(head);

    // shrink check：framed 摘要必须小于被压缩内容，否则回退原文截断
    const framed = frameSummary(text);
    if (estimateMessage({ role: 'system', content: framed }) >= headRouteTokens) {
      return frameSummary(fallbackSummary(head));
    }
    return framed;
  }

  /** 摘要模型：summarizationProvider/Model 非空 → 独立 ModelClient；否则复用传入 client */
  private resolveSummaryClient(modelClient: ModelClient): ModelClient {
    if (this.settings.summarizationProvider && this.settings.summarizationModel) {
      if (!this.modelConfig) {
        throw new Error('cannot resolve summarization model without agent modelConfig');
      }
      return new ModelClient(createLanguageModel({
        ...this.modelConfig,
        provider: this.settings.summarizationProvider,
        model: this.settings.summarizationModel,
      }));
    }
    return modelClient;
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter @vico/core exec vitest run src/agent/context-compactor.test.ts`
Expected: PASS。

- [ ] **Step 5: 追加集成测试并提交**

追加到 `context-compactor.test.ts`（验证 candidate 加载 + range 选择 + 摘要落库 + 归档 + 历史只剩摘要+尾部）：

```ts
describe('ModelContextCompactor 集成', () => {
  it('compactNow 压缩除保留尾部外的 completed turn，历史只含摘要+尾部', async () => {
    const store = new InMemoryThreadStore();
    // 长文本保证 head token（约 516）明显大于摘要（约 42），shrink check 通过
    await seed(store, ['x'.repeat(1000), 'y'.repeat(1000), 'z'.repeat(1000)]);
    const thread = (await store.getThread('thread-1'))!;
    const c = new ModelContextCompactor({
      thread: store,
      conversationWindow: 10,
      modelConfig: { provider: 'openai', model: 'gpt', apiKey: 'k', contextWindow: 100000 },
      settings: { retainTokens: 1 }, // 只保留最后 1 turn
    });

    const result = await c.compactNow(thread, fakeClient(), new AbortController().signal);
    expect(result).not.toBeNull();
    expect(result!.archivedTurnIds).toHaveLength(2); // 前两个 turn 被归档

    // 摘要消息已写入，role='summary'
    const summaries = await store.getEntries('thread-1', { roles: ['summary'], includeArchived: false });
    expect(summaries).toHaveLength(1);
    expect(JSON.parse(summaries[0].content)).toContain('compacted summary text');

    // 非归档消息 = 1 条摘要 + 尾部 turn（z）
    const active = await store.getEntries('thread-1', { includeArchived: false });
    const nonSummary = active.filter((m) => m.role !== 'summary');
    expect(nonSummary.map((m) => JSON.parse(m.content))).toEqual(['z'.repeat(1000)]);
  });

  it('摘要 LLM 失败时回退原文截断且不归档', async () => {
    const store = new InMemoryThreadStore();
    await seed(store, ['x'.repeat(1000), 'y'.repeat(1000), 'z'.repeat(1000)]);
    const thread = (await store.getThread('thread-1'))!;
    const failingClient = {
      stream: vi.fn(async () => { throw new Error('boom'); }),
    } as unknown as ModelClient;
    const c = new ModelContextCompactor({
      thread: store,
      conversationWindow: 10,
      modelConfig: { provider: 'openai', model: 'gpt', apiKey: 'k', contextWindow: 100000 },
      settings: { retainTokens: 1 },
    });
    const result = await c.compactNow(thread, failingClient, new AbortController().signal);
    expect(result).not.toBeNull();
    const summaries = await store.getEntries('thread-1', { roles: ['summary'] });
    expect(JSON.parse(summaries[0].content)).toContain('user: x'); // 回退原文截断
  });

  it('摘要不小于被压缩内容时回退原文截断（shrink check）', async () => {
    const store = new InMemoryThreadStore();
    await seed(store, ['x'.repeat(1000), 'y'.repeat(1000), 'z'.repeat(1000)]);
    const thread = (await store.getThread('thread-1'))!;
    // 返回超长摘要（约 3000 chars ≈ 754 tokens）大于 head（约 516），触发 shrink check 回退
    const hugeClient = {
      stream: vi.fn(async () => {
        const huge = 'A'.repeat(3000);
        const parts = [{ type: 'text-delta', delta: huge }];
        return { stream: ReadableStream.from(parts), readText: async () => huge };
      }),
    } as unknown as ModelClient;
    const c = new ModelContextCompactor({
      thread: store,
      conversationWindow: 10,
      modelConfig: { provider: 'openai', model: 'gpt', apiKey: 'k', contextWindow: 100000 },
      settings: { retainTokens: 1 },
    });
    const result = await c.compactNow(thread, hugeClient, new AbortController().signal);
    expect(result).not.toBeNull();
    const summaries = await store.getEntries('thread-1', { roles: ['summary'] });
    expect(JSON.parse(summaries[0].content)).toContain('user: x'); // shrink check 失败 → 回退原文截断
  });
});
```

Run: `pnpm --filter @vico/core exec vitest run src/agent/context-compactor.test.ts`
Expected: PASS。

```bash
git add packages/core/src/agent/context-compactor.ts packages/core/src/agent/context-compactor.test.ts
git commit -m "feat(core): ModelContextCompactor 持久化增量滚动压缩"
```

---

### Task 5: ConversationHistoryMemory 改造

**Files:**
- Modify: `packages/core/src/memory/conversation-history-memory.ts`
- Test: `packages/core/src/memory/conversation-history-memory.test.ts`（新建）

**Interfaces:**
- Consumes: Task 3 的 `ThreadStore.getEntries`（roles/includeArchived）/`getRecentTurns`/`getEntriesByTurns`；`toModelMessages`/`getMessageText`
- Produces: `ConversationHistoryMemory.get(threadId)` 返回 `[摘要(role='system')] ++ [最近 N 个 completed turn 的非归档消息]`

- [ ] **Step 1: 写失败测试**

```ts
// packages/core/src/memory/conversation-history-memory.test.ts
import { describe, expect, it } from 'vitest';
import { InMemoryThreadStore } from '../thread/memory-thread-store.js';
import { ConversationHistoryMemory } from './conversation-history-memory.js';

async function seed(): Promise<{ store: InMemoryThreadStore; turnIds: string[] }> {
  const store = new InMemoryThreadStore();
  await store.createThread('agent', 't', 'thread-1');
  const turnIds: string[] = [];
  for (const [text, status] of [['one', 'completed'], ['two', 'completed'], ['three', 'failed']] as const) {
    const turn = await store.createTurn('thread-1');
    turnIds.push(turn.id);
    await store.appendEntries([{ threadId: 'thread-1', turnId: turn.id, role: 'user', content: JSON.stringify(text) }]);
    await store.updateTurn(turn.id, { status });
  }
  return { store, turnIds };
}

describe('ConversationHistoryMemory.get', () => {
  it('只读取 completed turn（failed 被过滤）', async () => {
    const { store } = await seed();
    const mem = new ConversationHistoryMemory(store, 10);
    const history = await mem.get('thread-1');
    expect(history.map((m) => (m.content as string))).toEqual(['one', 'two']);
  });

  it('摘要消息前置并转 role=system，归档消息不读取', async () => {
    const { store, turnIds } = await seed();
    // 归档 first turn 的消息
    const first = await store.getEntriesByTurns([turnIds[0]]);
    await store.archiveMessages('thread-1', first.map((m) => m.id));
    // 写一条摘要
    await store.appendEntries([{ threadId: 'thread-1', turnId: 'thread-1', role: 'summary', content: JSON.stringify('prior summary') }]);

    const mem = new ConversationHistoryMemory(store, 10);
    const history = await mem.get('thread-1');
    expect(history[0]).toEqual({ role: 'system', content: 'prior summary' });
    // 归档 turn 不再出现在历史
    expect(history.map((m) => (m.content as string))).not.toContain('one');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @vico/core exec vitest run src/memory/conversation-history-memory.test.ts`
Expected: FAIL（当前实现不过滤 completed、不读摘要）。

- [ ] **Step 3: 实现**

```ts
// @vico/core - ConversationHistoryMemory: 摘要（前置）+ 最近 N 个已完成 turn 的非归档消息
import type {ThreadStore} from '../thread/thread-store.js';
import type {ModelMessage} from 'ai';
import {toModelMessages} from '../thread/utils.js';
import {getMessageText} from '../model/message-utils.js';

/**
 * 包装 ThreadStore，按已完结轮次读取会话历史并转为模型格式。
 * conversationWindow 表示取最近 N 轮已完结的轮次（status === 'completed'）。
 * 历史 = 最新非归档摘要（role='summary' → system，前置）+ 这些 turn 的非归档消息。
 */
export class ConversationHistoryMemory {

  constructor(readonly threadStore: ThreadStore, readonly conversationWindow: number) {}

  async get(threadId: string): Promise<ModelMessage[]> {
    const [summaryEntries, turns] = await Promise.all([
      this.threadStore.getEntries(threadId, { roles: ['summary'], includeArchived: false }),
      this.threadStore.getRecentTurns(threadId, this.conversationWindow, 'completed'),
    ]);

    const summary = summaryEntries.length > 0 ? toModelMessages([summaryEntries[summaryEntries.length - 1]])[0] : null;
    const ordered = [...turns].reverse(); // 升序（最旧在前）
    const entries = ordered.length > 0
      ? await this.threadStore.getEntriesByTurns(ordered.map((t) => t.id), { includeArchived: false })
      : [];

    const result: ModelMessage[] = [];
    if (summary) result.push({ role: 'system', content: getMessageText(summary) });
    result.push(...toModelMessages(entries));
    return result;
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter @vico/core exec vitest run src/memory/conversation-history-memory.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add packages/core/src/memory/conversation-history-memory.ts packages/core/src/memory/conversation-history-memory.test.ts
git commit -m "feat(core): 历史加载含摘要前置与 completed/归档过滤"
```

---

### Task 6: LoopAgent 接线 + Agent 契约 + 类型扩展

**Files:**
- Modify: `packages/core/src/agent/types.ts`（`ModelConfig.contextWindow` + `TurnEvent.compacted` 扩充）
- Modify: `packages/core/src/agent/loop-agent-options.ts`（`TurnContext.historyCount`）
- Modify: `packages/core/src/agent/agent.ts`（`Agent.compactThread`）
- Modify: `packages/core/src/agent/loop-agent.ts`（删 tryCompact、pressure 触发、context-overflow 重试、compactThread、recordUsage）

**Interfaces:**
- Consumes: Task 4 的 `ContextCompactor`/`CompactionResult`/`isContextOverflowError`
- Produces: `Agent.compactThread(threadId, signal?)`；`ModelConfig.contextWindow?: number`；`TurnEvent.compacted` 五字段；`TurnContext.historyCount: number`

- [ ] **Step 1: types.ts 修改**

```ts
// ModelConfig 追加
export interface ModelConfig {
  provider: string;
  model: string;
  baseUrl?: string;
  apiKey: string;
  /** 模型上下文窗口 token 数；启用压缩（pressure 触发）时必填（provider v4 不暴露） */
  contextWindow?: number;
}

// TurnEvent 的 compacted 替换为五字段
| { type: 'compacted';
    summaryMessageId: string;
    archivedTurnIds: string[];
    removedTokens: number;
    shadowedTokenCount: number }
```

- [ ] **Step 2: loop-agent-options.ts 修改**

```ts
export interface TurnContext<TToolSet extends ToolSet = ToolSet> {
  // ...existing
  /** turn 开始时注入的历史消息条数（context-overflow 压缩后据此重建内存历史前缀） */
  historyCount: number;
}
```

- [ ] **Step 3: agent.ts 修改**

顶部 import（现有 `import type {ContextCompactor} from './context-compactor.js';`）改为同时导入 `CompactionResult`：

```ts
import type {ContextCompactor, CompactionResult} from './context-compactor.js';
```

在 `Agent` 接口末尾（`stream` 之后）追加：

```ts
  /**
   * 主动压缩指定会话：忽略 token 阈值，压缩除最近保留 turn 外的全部已完成 turn。
   * 无可用区间时返回 null（不写库）；thread 不存在或未配置 compactor 返回 null。
   *
   * @param threadId - 会话 ID
   * @param signal - 可选中断信号
   */
  compactThread(threadId: string, signal?: AbortSignal): Promise<CompactionResult | null>;
```

- [ ] **Step 4: loop-agent.ts 修改（4 处）**

**(a) 删除死代码 `tryCompact` 与 `executeModelStep` 中的调用**：删除 `loop-agent.ts:805-813` 的 `tryCompact` 方法，删除 `loop-agent.ts:615` 的 `await this.tryCompact(step, context);`。

**(b) `start()` 新 turn 分支触发 pressure 压缩**（替换 `else` 分支）：

```ts
    if (latestTurn && latestTurn.status !== 'completed') {
      turn = latestTurn;
      checkpoint = await this.checkpointStore.getLatest(latestTurn.id)
    } else {
      // ── 正常新 turn ── 历史压力压缩（只压缩已完成 turn，在创建 turn / 注入历史前）
      await this.compactForPressure(thread, modelClient, signal);
      turn = await this.thread.createTurn(thread.id);
    }
```

**(c) `startTurn()` 记录 historyCount**（替换 `pipeline.enter` 到 `context` 构造段）：

```ts
    const {decisions} = extractApprovalResponses(userMessages)

    const userMessageCount = userMessages.length;
    const requestContext = new ModelRequestContext({agent: this, userMessages, tools: this.tools, session});
    await this.pipeline.enter(requestContext);
    // 历史由 MemoryProcessor unshift 注入；记录条数供 context-overflow 压缩后重建内存历史前缀
    const historyCount = requestContext.messages.length - userMessageCount;

    const context: TurnContext<TToolSet> = {
      ctx: requestContext,
      messages: [...requestContext.messages],
      decisions: decisions,
      approvedTools: new Map<string, ToolApproval>(),
      session,
      signal,
      controller,
      checkpoint,
      usage: { input: 0, output: 0 },
      reasoning,
      modelClient,
      approvalMode,
      historyCount,
    };
```

**(d) 重写 `callModel`（recordUsage + context-overflow 重试 + 历史重建）**：

```ts
  private async callModel(step: TurnStep, context: TurnContext<TToolSet>): Promise<CallModelResult> {
    const { ctx, controller } = context;

    const resolveError = (error: Error | string): CallModelResult => {
      this.emit({ type: 'error', error });
      try {
        controller.enqueue({ type: 'error', error });
      } catch (e) {
        this.log.warn({ threadId: context.session.thread.id, err: e }, 'controller closed, error enqueue ignored');
      }
      return { text: '', reasoning: '', toolCalls: [], usage: { input: 0, output: 0 }, error };
    };

    // 单次模型调用（可被 context-overflow 重试复用）
    const attempt = async (): Promise<CallModelResult> => {
      const cleaned = ensureToolCallConsistency(step.messages);
      const request: ModelRequest = {
        system: ctx.getSystemPrompt(),
        messages: cleaned,
        tools: ctx.tools,
        maxOutputTokens: this.maxTokens,
        temperature: this.temperature,
        reasoning: context.reasoning ?? this.reasoning,
        abortSignal: context.signal,
      };
      try {
        const {stream} = await context.modelClient.stream(request);
        const reader = new ModelStreamReader<TToolSet>({ controller, emit: this.emit, request });
        return reader.read(stream);
      } catch (e) {
        return resolveError(e instanceof Error ? e : new Error(String(e)));
      }
    };

    const first = await attempt();

    // usage 锚定：无论成功失败，记录 provider 上报的 prompt token
    this.compactor?.recordUsage(context.session.thread.id, first.usage.input);

    // 正常响应 → 清零 context-overflow 重试计数
    if (!first.error) {
      this.compactor?.noteModelSuccess(context.session.thread);
      return first;
    }

    // context-overflow 恢复：启发式检测超限错误 → 压缩（retainTokens=0）→ 重建历史 → 重试一次
    if (this.compactor && !context.signal.aborted && isContextOverflowError(first.error)) {
      try {
        const result = await this.compactor.compactIfNeeded(context.session.thread, context.modelClient, 'context-overflow', context.signal);
        if (result) {
          this.emitCompacted(result);
          await this.refreshHistory(context);
          return attempt();
        }
      } catch (err) {
        this.log.warn({ threadId: context.session.thread.id, err }, 'context-overflow compaction failed');
      }
    }

    return first;
  }
```

**(e) 新增辅助方法 `compactForPressure` / `emitCompacted` / `refreshHistory` / `compactThread`**（追加到类内，`appendToolResults` 之后）：

```ts
  /**
   * 新 turn 开始前的压力压缩。未配置 compactor 或 contextWindow 缺失时静默跳过（告警），不阻塞 turn。
   */
  private async compactForPressure(thread: Thread, modelClient: ModelClient, signal: AbortSignal): Promise<void> {
    if (!this.compactor) return;
    try {
      const result = await this.compactor.compactIfNeeded(thread, modelClient, 'pressure', signal);
      if (result) this.emitCompacted(result);
    } catch (err) {
      this.log.warn({ threadId: thread.id, err }, 'pressure compaction skipped');
    }
  }

  /** 发射压缩事件（compacted 五字段） */
  private emitCompacted(result: CompactionResult): void {
    this.emit({
      type: 'compacted',
      summaryMessageId: result.summaryMessageId,
      archivedTurnIds: result.archivedTurnIds,
      removedTokens: result.removedTokens,
      shadowedTokenCount: result.shadowedTokenCount,
    });
  }

  /** context-overflow 压缩后，用新历史替换内存中的旧历史前缀（原地 splice 使 step.messages 同步） */
  private async refreshHistory(context: TurnContext<TToolSet>): Promise<void> {
    if (!this.memory.conversation || context.historyCount === 0) return;
    const fresh = await this.memory.conversation.get(context.session.thread.id);
    context.messages.splice(0, context.historyCount, ...fresh);
    context.historyCount = fresh.length;
  }

  /** Agent.compactThread 实现：主动压缩指定会话 */
  async compactThread(threadId: string, signal?: AbortSignal): Promise<CompactionResult | null> {
    if (!this.compactor) return null;
    const thread = await this.thread.getThread(threadId);
    if (!thread) return null;
    return this.compactor.compactNow(thread, this.modelClient, signal ?? new AbortController().signal);
  }
```

同时更新 `loop-agent.ts` 顶部 import：加入 `CompactionResult`、`isContextOverflowError`：

```ts
import {isContextOverflowError, type CompactionResult, type ContextCompactor} from './context-compactor.js';
```

（原 `import type {ContextCompactor} from './context-compactor.js';` 改为上述。）

- [ ] **Step 5: 运行 typecheck**

Run: `pnpm --filter @vico/core typecheck`
Expected: 无类型错误（`TurnContext` 新字段 `historyCount` 已在所有构造点补齐）。

- [ ] **Step 6: 提交**

```bash
git add packages/core/src/agent/types.ts packages/core/src/agent/loop-agent-options.ts packages/core/src/agent/agent.ts packages/core/src/agent/loop-agent.ts
git commit -m "feat(core): LoopAgent 接入双 trigger 压缩与 Agent.compactThread"
```

---

### Task 7: createAgent / Vico 装配 + index 导出

**Files:**
- Modify: `packages/core/src/agent/create-agent.ts`（`AgentConfig.compaction` + 构造 compactor）
- Modify: `packages/core/src/agent/vico.ts`（`VicoOptions.compaction` 透传）
- Modify: `packages/core/src/index.ts`（导出新符号）

**Interfaces:**
- Consumes: Task 4 的 `ModelContextCompactor`/`CompactionSettings`/`CompactionResult`/`CompactionTrigger`/`ManualCompactionError` 等；Task 1/2 的导出
- Produces: `AgentConfig.compaction?: Partial<CompactionSettings>`；`VicoOptions.compaction?: Partial<CompactionSettings>`

- [ ] **Step 1: create-agent.ts 修改**

`AgentConfig` 追加字段（`checkpointStore?` 之后）：

```ts
  checkpointStore?: CheckpointStore;
  /** 上下文压缩配置；未传则不构造 compactor（自动压缩关闭，向后兼容） */
  compaction?: Partial<CompactionSettings>;
```

`createAgent` 里构造 compactor（在 `const skills = ...` 之后、`return new LoopAgent(...)` 之前）：

```ts
  // 上下文压缩器：仅在显式配置 compaction 时构造；模型为 ModelConfig 时才能拿到 contextWindow/摘要模型
  const modelConfig = !isLanguageModelV4(config.model) ? config.model : undefined;
  const compactor = config.compaction
    ? new ModelContextCompactor({
        thread,
        conversationWindow: config.conversationWindow ?? DEFAULT_CONVERSATION_WINDOW,
        modelConfig,
        maxTokens: config.maxTokens,
        settings: config.compaction,
      })
    : undefined;
```

并在 `new LoopAgent({...})` 传 `compactor`（`checkpointStore` 之后）：

```ts
    checkpointStore: config.checkpointStore || new MemoryCheckpointStore(),
    compactor,
```

顶部 import 追加：

```ts
import {isLanguageModelV4} from './types.js';
import {ModelContextCompactor, type CompactionSettings} from './context-compactor.js';
```

（`isLanguageModelV4` 已从 `./types.js` 导出；若 create-agent 未引入则补上。）

- [ ] **Step 2: vico.ts 修改**

`VicoOptions` 追加（`checkpointStore?` 之后）：

```ts
  /** 全局默认压缩配置（agent 自身未配置 compaction 时使用） */
  compaction?: Partial<CompactionSettings>;
```

`buildAgent` 的 `createAgent({...})` 里追加透传：

```ts
      checkpointStore: config.checkpointStore ?? this.checkpointStore,
      events: config.events ?? this.events,
      compaction: config.compaction ?? this.options.compaction,
```

顶部 import 追加：

```ts
import type {CompactionSettings} from './context-compactor.js';
```

- [ ] **Step 3: index.ts 导出追加**

替换现有 `// ContextCompactor` 导出块（`packages/core/src/index.ts:137-138`，原 `export { ContextCompactor }` 导出的是旧 class，重写后为 interface，须改为 type 导出）：

```ts
// ContextCompactor（值导出：实现类 / 错误类 / 超限检测函数）
export {
  ModelContextCompactor,
  ManualCompactionError,
  TargetPressureConfigError,
  isContextOverflowError,
} from './agent/context-compactor.js';
// ContextCompactor（类型导出：端口 / 结果 / 触发类型）
export type {
  ContextCompactor,
  CompactionTrigger,
  CompactionResult,
  ManualCompactionErrorCode,
  ModelContextCompactorOptions,
} from './agent/context-compactor.js';
export {
  COMPACTION_INSTRUCTION,
  CHECKPOINT_PREAMBLE,
  SUMMARY_OPEN_TAG,
  SUMMARY_CLOSE_TAG,
} from './agent/context-compactor.js';
export {
  resolveSettings,
  resolveCompactSpec,
  selectCompactableRange,
  DEFAULT_COMPACTION_SETTINGS,
  type CompactionSettings,
  type ResolvedCompactionSettings,
  type ResolvedCompactSpec,
  type CompactionModelPolicy,
  type TurnTokenBudget,
  type CompactableRange,
} from './agent/compaction-config.js';
export {
  estimateContent,
  estimateMessage,
  measure,
  CHARS_PER_TOKEN,
  BLOCK_OVERHEAD,
  ROLE_OVERHEAD,
  type TokenAnchor,
  type PricedMessage,
  type TokenMeasurement,
} from './agent/token-estimator.js';
```

- [ ] **Step 4: 运行 typecheck**

Run: `pnpm --filter @vico/core typecheck`
Expected: 无类型错误。

- [ ] **Step 5: 提交**

```bash
git add packages/core/src/agent/create-agent.ts packages/core/src/agent/vico.ts packages/core/src/index.ts
git commit -m "feat(core): createAgent/Vico 装配 compactor 并导出公开 API"
```

---

### Task 8: libsql-adapter 适配

**Files:**
- Modify: `packages/libsql-adapter/src/schema.ts`（`messages` 加 `archived` 列）
- Modify: `packages/libsql-adapter/src/migrate.ts`（`archived` 迁移检测）
- Modify: `packages/libsql-adapter/src/libsql-thread-store.ts`（`includeArchived` + `archiveMessages`）
- Test: `packages/libsql-adapter/src/libsql-thread-store.test.ts`（新建，`:memory:` 集成）

**Interfaces:**
- Consumes: Task 3 的端口签名
- Produces: `LibSqlThreadStore` 满足扩展后的 `ThreadStore`

- [ ] **Step 1: schema.ts 修改**

```ts
export const messages = sqliteTable('vico_messages', {
  id: text('id').primaryKey(),
  thread_id: text('thread_id').notNull(),
  turn_id: text('turn_id').notNull(),
  role: text('role').notNull(),
  content: text('content').notNull(),
  metadata: text('metadata'),
  /** 是否已被压缩归档（soft delete；模型上下文不读，UI 全量展示） */
  archived: integer('archived', { mode: 'boolean' }).notNull().default(false),
  created_at: integer('created_at').notNull(),
});
```

- [ ] **Step 2: migrate.ts 修改**（在 `vico_messages` 建表后追加迁移检测）

```ts
  await db.run(sql`
    CREATE INDEX IF NOT EXISTS idx_msg_thread
    ON vico_messages(thread_id)
  `);

  // 迁移检测：存量 vico_messages 无 archived 列 → 幂等补列
  const msgCols = await db.values<[string]>(sql`
    SELECT name FROM pragma_table_info('vico_messages')
  `);
  const msgColNames = msgCols.map((r) => r[0]);
  if (msgColNames.length > 0 && !msgColNames.includes('archived')) {
    await db.run(sql`ALTER TABLE vico_messages ADD COLUMN archived INTEGER NOT NULL DEFAULT 0`);
  }
```

- [ ] **Step 3: libsql-thread-store.ts 修改**

`getEntries` / `getEntriesByTurns` 加归档过滤，新增 `archiveMessages`：

```ts
  async getEntries(
    threadId: string,
    options?: { limit?: number; start?: number; roles?: string[]; includeArchived?: boolean },
  ): Promise<Message[]> {
    const start = options?.start ?? 0;
    const conditions = [eq(messages.thread_id, threadId)];
    if (options?.roles?.length) {
      conditions.push(inArray(messages.role, options.roles));
    }
    if (options?.includeArchived === false) {
      conditions.push(eq(messages.archived, false));
    }
    const base = this.db
      .select()
      .from(messages)
      .where(and(...conditions))
      .orderBy(messages.created_at)
      .offset(start);
    const rows = await (options?.limit ? base.limit(options.limit) : base);
    return rows.map((r) => this._toMessage(r));
  }

  async getEntriesByTurns(turnIds: string[], options?: { includeArchived?: boolean }): Promise<Message[]> {
    if (turnIds.length === 0) return [];
    const conditions = [inArray(messages.turn_id, turnIds)];
    if (options?.includeArchived === false) {
      conditions.push(eq(messages.archived, false));
    }
    const rows = await this.db
      .select()
      .from(messages)
      .where(and(...conditions))
      .orderBy(messages.created_at);
    return rows.map((r) => this._toMessage(r));
  }

  async archiveMessages(threadId: string, messageIds: string[]): Promise<void> {
    if (messageIds.length === 0) return;
    await this.db
      .update(messages)
      .set({ archived: true })
      .where(and(eq(messages.thread_id, threadId), inArray(messages.id, messageIds)));
  }
```

`_toMessage` 追加 `archived` 映射：

```ts
      archived: r.archived,
```

- [ ] **Step 4: 写集成测试并运行**

```ts
// packages/libsql-adapter/src/libsql-thread-store.test.ts
import { describe, expect, it, beforeAll } from 'vitest';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import * as schema from './schema.js';
import { ensureTables } from './migrate.js';
import { LibSqlThreadStore } from './libsql-thread-store.js';

describe('LibSqlThreadStore archiveMessages / includeArchived', () => {
  let store: LibSqlThreadStore;
  beforeAll(async () => {
    const client = createClient({ url: ':memory:' });
    const db = drizzle(client, { schema });
    await ensureTables(db as never);
    store = new LibSqlThreadStore({ db: db as never });
  });

  it('archiveMessages 软标记；includeArchived:false 排除', async () => {
    await store.createThread('a', 't', 'thread-1');
    const [m1, m2] = await store.appendEntries([
      { threadId: 'thread-1', turnId: 'turn-1', role: 'user', content: '"hi"' },
      { threadId: 'thread-1', turnId: 'turn-1', role: 'assistant', content: '"yo"' },
    ]);
    await store.archiveMessages('thread-1', [m1.id]);
    const active = await store.getEntries('thread-1', { includeArchived: false });
    expect(active.map((m) => m.id)).toEqual([m2.id]);
    const byTurn = await store.getEntriesByTurns(['turn-1'], { includeArchived: false });
    expect(byTurn.map((m) => m.id)).toEqual([m2.id]);
  });
});
```

Run: `pnpm --filter @vico/libsql-adapter exec vitest run src/libsql-thread-store.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add packages/libsql-adapter/src/schema.ts packages/libsql-adapter/src/migrate.ts packages/libsql-adapter/src/libsql-thread-store.ts packages/libsql-adapter/src/libsql-thread-store.test.ts
git commit -m "feat(libsql-adapter): vico_messages.archived 列 + archiveMessages/includeArchived"
```

---

### Task 9: mysql-adapter 适配

**Files:**
- Modify: `packages/mysql-adapter/src/schema.ts`（`archived` 列）
- Modify: `packages/mysql-adapter/src/migrate.ts`（`archived` 迁移检测）
- Modify: `packages/mysql-adapter/src/mysql-thread-store.ts`（`includeArchived` + `archiveMessages` + `_toMessage`）

**Interfaces:**
- Consumes: Task 3 的端口签名
- Produces: `MysqlThreadStore` 满足扩展后的 `ThreadStore`

> 说明：mysql 无内存模式且 CI 无 mysql 实例，本任务与 Task 8 逻辑对称（纯 SQL 薄映射），不写运行时测试，以 `typecheck` 验证（`_toMessage` 的 `archived` 字段由 core 端口类型驱动）。

- [ ] **Step 1: schema.ts 修改**

```ts
export const messages = mysqlTable('vico_messages', {
  id: varchar('id', { length: 36 }).primaryKey(),
  thread_id: varchar('thread_id', { length: 36 }).notNull(),
  turn_id: varchar('turn_id', { length: 36 }).notNull(),
  role: varchar('role', { length: 36 }).notNull(),
  content: text('content').notNull(),
  metadata: json('metadata'),
  /** 是否已被压缩归档（soft delete） */
  archived: boolean('archived').notNull().default(false),
  created_at: bigint('created_at', { mode: 'number' }).notNull(),
});
```

- [ ] **Step 2: migrate.ts 修改**（在 `vico_messages` 建表后追加）

```ts
  // 迁移检测：存量 vico_messages 无 archived 列 → 幂等补列
  const msgCols = await db.execute(sql`
    SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'vico_messages'
  `);
  const msgColNames = (msgCols[0] as unknown as Array<{ COLUMN_NAME: string }>).map((r) => r.COLUMN_NAME);
  if (msgColNames.length > 0 && !msgColNames.includes('archived')) {
    await db.execute(sql`ALTER TABLE vico_messages ADD COLUMN archived BOOLEAN NOT NULL DEFAULT FALSE`);
  }
```

- [ ] **Step 3: mysql-thread-store.ts 修改**（与 Task 8 Step 3 对称）

```ts
  async getEntries(
    threadId: string,
    options?: { limit?: number; start?: number; roles?: string[]; includeArchived?: boolean },
  ): Promise<Message[]> {
    const start = options?.start ?? 0;
    const conditions = [eq(messages.thread_id, threadId)];
    if (options?.roles?.length) {
      conditions.push(inArray(messages.role, options.roles));
    }
    if (options?.includeArchived === false) {
      conditions.push(eq(messages.archived, false));
    }
    const base = this.db
      .select()
      .from(messages)
      .where(and(...conditions))
      .orderBy(messages.created_at)
      .offset(start);
    const rows = await (options?.limit ? base.limit(options.limit) : base);
    return rows.map((r) => this._toMessage(r));
  }

  async getEntriesByTurns(turnIds: string[], options?: { includeArchived?: boolean }): Promise<Message[]> {
    if (turnIds.length === 0) return [];
    const conditions = [inArray(messages.turn_id, turnIds)];
    if (options?.includeArchived === false) {
      conditions.push(eq(messages.archived, false));
    }
    const rows = await this.db
      .select()
      .from(messages)
      .where(and(...conditions))
      .orderBy(messages.created_at);
    return rows.map((r) => this._toMessage(r));
  }

  async archiveMessages(threadId: string, messageIds: string[]): Promise<void> {
    if (messageIds.length === 0) return;
    await this.db
      .update(messages)
      .set({ archived: true })
      .where(and(eq(messages.thread_id, threadId), inArray(messages.id, messageIds)));
  }
```

`_toMessage` 追加：

```ts
      archived: r.archived,
```

- [ ] **Step 4: typecheck**

Run: `pnpm --filter @vico/mysql-adapter typecheck`
Expected: 无类型错误。

- [ ] **Step 5: 提交**

```bash
git add packages/mysql-adapter/src/schema.ts packages/mysql-adapter/src/migrate.ts packages/mysql-adapter/src/mysql-thread-store.ts
git commit -m "feat(mysql-adapter): vico_messages.archived 列 + archiveMessages/includeArchived"
```

---

### Task 10: server 装配 + HTTP API

**Files:**
- Modify: `vico/server/src/config.ts`（`memory.compaction` + `model.context_window`）
- Modify: `vico/server/server.config.yaml`（compaction 配置 + 模型 context_window）
- Modify: `vico/server/src/agent/get-agent.ts`（透传 compaction / conversationWindow / contextWindow）
- Modify: `vico/server/src/api/threads.ts`（`POST /api/v1/threads/:id/compact`）

**Interfaces:**
- Consumes: Task 7 的 `AgentConfig.compaction`/`AgentConfig.conversationWindow`；`CompactionSettings`/`CompactionResult`/`ManualCompactionError`（`@vico/core`）
- Produces: `POST /api/v1/threads/:id/compact`

- [ ] **Step 1: config.ts 修改**

`AppConfig.memory` 追加 `compaction`；顶层追加 `model`：

```ts
  memory: {
    stm_window: number;
    ltm_auto_extract: boolean;
    ltm_max_entries: number;
    /** 上下文压缩配置（snake_case，对齐 server.config.yaml；由 get-agent 转 CompactionSettings） */
    compaction?: {
      auto?: boolean;
      threshold_ratio?: number;
      headroom_tokens?: number;
      retain_ratio?: number;
      retain_tokens?: number;
      summarization_provider?: string;
      summarization_model?: string;
      max_tokens?: number;
      compaction_retries?: number;
      max_overflow_retries?: number;
    };
  };
  /** 聊天模型全局默认上下文窗口（provider v4 不暴露 contextWindow，压缩判定需显式声明） */
  model?: {
    context_window?: number;
  };
```

`defaultConfig.memory` 追加 `compaction` 默认（与 `DEFAULT_COMPACTION_SETTINGS` 对齐）：

```ts
    memory: {
      stm_window: 20, ltm_auto_extract: true, ltm_max_entries: 10000,
      compaction: {
        auto: true,
        threshold_ratio: 0.8,
        headroom_tokens: 65536,
        retain_ratio: 0.16,
        max_tokens: 65536,
        compaction_retries: 1,
        max_overflow_retries: 1,
      },
    },
    model: { context_window: 131072 },
```

`merged` 里追加：

```ts
      memory: { ...defaultConfig.memory, ...parsed.memory, compaction: { ...defaultConfig.memory.compaction, ...parsed.memory?.compaction } },
      model: { ...defaultConfig.model, ...parsed.model },
```

- [ ] **Step 2: server.config.yaml 修改**

```yaml
memory:
  stm_window: 20
  ltm_auto_extract: true
  ltm_max_entries: 10000
  compaction:
    auto: true
    threshold_ratio: 0.8
    headroom_tokens: 65536
    retain_ratio: 0.16
    max_tokens: 65536
    compaction_retries: 1
    max_overflow_retries: 1

# 聊天模型全局默认上下文窗口（provider v4 不暴露 contextWindow，压缩判定用）
model:
  context_window: 131072
```

- [ ] **Step 3: get-agent.ts 修改**

`buildAgentConfig` 里 `model` 加 `contextWindow`、`AgentConfig` 加 `conversationWindow`/`compaction`；并新增转换函数：

```ts
import {config} from '../config.js';
import type {CompactionSettings} from '@vico/core';

/** config.yaml 的 snake_case compaction 配置 → core CompactionSettings（camelCase） */
function toCompactionSettings(raw: NonNullable<typeof config.memory.compaction> | undefined): Partial<CompactionSettings> | undefined {
  if (!raw) return undefined;
  return {
    auto: raw.auto,
    thresholdRatio: raw.threshold_ratio,
    headroomTokens: raw.headroom_tokens,
    retainRatio: raw.retain_ratio,
    retainTokens: raw.retain_tokens,
    summarizationProvider: raw.summarization_provider,
    summarizationModel: raw.summarization_model,
    maxTokens: raw.max_tokens,
    compactionRetries: raw.compaction_retries,
    maxOverflowRetries: raw.max_overflow_retries,
  };
}
```

`buildAgentConfig` 的 return 改为：

```ts
  return {
    id: a.id,
    name: a.name,
    systemPrompt: a.system_prompt,
    model: {
      provider: model.provider,
      model: model.model_name,
      baseUrl: model.base_url,
      apiKey: model.api_key,
      contextWindow: config.model?.context_window,
    },
    temperature: a.temperature ?? 0.7,
    maxTokens: a.max_tokens ?? 4096,
    maxSteps: a.max_steps ?? 10,
    conversationWindow: config.memory.stm_window,
    compaction: toCompactionSettings(config.memory.compaction),
    workspace,
    skills,
  };
```

- [ ] **Step 4: threads.ts 新增路由**

```ts
import type {ManualCompactionError} from '@vico/core';

  /** POST /api/v1/threads/:id/compact — 主动压缩会话历史 */
  app.post('/api/v1/threads/:id/compact', async (c) => {
    const auth = await getAuthContext(c);
    if (auth instanceof Response) return auth;

    const threadId = c.req.param('id');
    const thread = await threadManager.getById(auth.userId, threadId);
    if (!thread) return c.json({ error: 'Thread not found' }, 404);

    const agent = await getAgent(thread.agentId);
    if (!agent.compactor) return c.json({ error: 'Compaction not configured for this agent' }, 501);

    try {
      const result = await agent.compactThread(threadId, c.req.raw.signal);
      if (!result) return c.json({ compacted: false });
      return c.json(result);
    } catch (err) {
      if (err instanceof ManualCompactionError) {
        const code = (err as ManualCompactionError).code;
        if (code === 'busy') return c.json({ error: 'Compaction already in progress' }, 409);
        return c.json({ error: err.message }, 400);
      }
      throw err;
    }
  });
```

> 说明：`threadManager.getById(auth.userId, threadId)` 返回 `ThreadDetail = { ...thread, messageCount, messages }`，`thread.agentId` 已在展开中透出（`Thread` 端口含 `agentId`），直接 `getAgent(thread.agentId)` 即可；该方法同时内置 `thread.userId !== userId` 的越权拦截，权限无需重复检查。

- [ ] **Step 5: typecheck + 构建**

Run: `pnpm --filter @vico/server exec tsc --noEmit`
Expected: 无类型错误（`@vico/server` 无 typecheck script，直接 `tsc --noEmit`）。

Run: `pnpm build`
Expected: 全部包构建成功。

- [ ] **Step 6: 提交**

```bash
git add vico/server/src/config.ts vico/server/server.config.yaml vico/server/src/agent/get-agent.ts vico/server/src/api/threads.ts
git commit -m "feat(server): 压缩配置装配 + POST /api/v1/threads/:id/compact"
```

---

## 收尾

- [ ] **全量测试**

Run: `pnpm --filter @vico/core test`
Expected: 全部 PASS。

- [ ] **文档沉淀**

在 `docs/insights/` 下创建 `context-compaction-实现说明.md`，记录：压缩触发点（turn 边界 pressure + callModel context-overflow）、摘要消息 `role='summary'`/`turnId=thread.id` 哨兵约定、先写后删崩溃安全、与 deepseek 的差异（contextWindow 显式配置、启发式超限检测、turn 级切分）。

- [ ] **最终提交（文档）**

```bash
git add docs/insights/context-compaction-实现说明.md
git commit -m "docs: 上下文压缩实现说明"
```
