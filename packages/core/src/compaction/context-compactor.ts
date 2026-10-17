// @vico/core - ContextCompactor 端口 + ModelContextCompactor 默认实现（持久化增量滚动压缩）
import {randomUUID} from 'node:crypto';
import type {ModelMessage} from 'ai';
import type {Thread, ThreadStore} from '../thread/thread-store.js';
import {ModelClient} from '../model/model-client.js';
import {createLanguageModel} from '../model/factory.js';
import type {ModelConfig} from '../model/types.js';
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
      if (summaryText === null) return null; // 摘要失败：不写、不归档（spec §10），下次 turn 再试

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

  /**
   * 增量摘要：独立摘要模型（若配置）或复用传入 modelClient。
   * 失败（重试耗尽 / 空输出 / shrink check 不通过）时返回 null——调用方 no-op，不写摘要、不归档（spec §10）。
   */
  private async summarize(head: ModelMessage[], oldSummary: ModelMessage | null, modelClient: ModelClient, signal: AbortSignal): Promise<string | null> {
    const client = this.resolveSummaryClient(modelClient);
    // shrink 基线 = 被归档口径（旧摘要 + head），与 selectCompactableRange 的 removedTokens 一致
    const headRouteTokens = measure(head).surfaceTokens + (oldSummary ? estimateMessage(oldSummary) : 0);

    // 摘要输入：旧摘要折叠进新摘要（以 system 角色传入——summary 非 provider 可识别角色，避免 standardizePrompt 拒绝）
    const input: ModelMessage[] = [];
    if (oldSummary) input.push({ role: 'system', content: getMessageText(oldSummary) });
    input.push(...head);

    // 摘要调用按 compactionRetries 重试；全部失败 → 返回 null（不写、不归档）
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
        if (attempt === this.settings.compactionRetries) return null;
      }
    }

    if (!text.trim()) return null; // 空输出 → 失败

    // shrink check：framed 摘要必须小于被压缩内容，否则返回 null（失败）
    const framed = frameSummary(text);
    if (estimateMessage({ role: 'system', content: framed }) >= headRouteTokens) {
      return null;
    }
    return framed;
  }

  /** 摘要模型：summarizationProvider/Model 非空 → 独立 ModelClient；否则复用传入 client */
  private resolveSummaryClient(modelClient: ModelClient): ModelClient {
    if (this.settings.summarizationProvider && this.settings.summarizationModel) {
      if (!this.modelConfig) {
        throw new ManualCompactionError('summary', 'cannot resolve summarization model without agent modelConfig');
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
