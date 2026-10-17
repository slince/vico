// @vico/compaction — ModelContextCompactor 默认实现（持久化增量滚动压缩）
import {randomUUID} from 'node:crypto';
import type {ModelMessage} from 'ai';
import type {Thread, ThreadStore} from '@vico/thread';
import {ModelClient, createLanguageModel, getMessageText} from '@vico/model';
import type {ModelConfig} from '@vico/model';
import {toModelMessages} from '@vico/thread';
import {KeyedMutex} from '@vico/utils';
import {measure, estimateMessage} from './token-estimator.js';
import {
  resolveSettings, resolveCompactSpec, selectCompactableRange,
  type ResolvedCompactionSettings,
} from './compaction-config.js';
import type {CompactionTrigger, CompactionResult, ContextCompactor, ModelContextCompactorOptions} from './types.js';
import {ManualCompactionError, TargetPressureConfigError} from './errors.js';
import {COMPACTION_INSTRUCTION, CHECKPOINT_PREAMBLE, SUMMARY_OPEN_TAG, SUMMARY_CLOSE_TAG} from './prompts.js';

/** 摘要消息固定 role 与 metadata 标识 */
const SUMMARY_ROLE = 'summary';
const SUMMARY_METADATA_KIND = 'compaction-summary';

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

  recordUsage(threadId: string, pressureTokens: number | undefined): void {
    if (pressureTokens === undefined) {
      // 无 usage 上报 → 清除锚点与上次采样，回退无锚定启发式估算（避免与后续 usage 错位配对）
      this.pressureTokens.delete(threadId);
      this.sampledSurfaceTokens.delete(threadId);
      return;
    }
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
      // 锚定需 pressureTokens 与 sampledSurfaceTokens 同周期配对；任一缺失则退化为无锚定启发式估算
      const hasAnchor = this.pressureTokens.has(thread.id) && this.sampledSurfaceTokens.has(thread.id);
      const anchor = hasAnchor
        ? { pressureTokens: this.pressureTokens.get(thread.id)!, sampledSurfaceTokens: this.sampledSurfaceTokens.get(thread.id)! }
        : undefined;
      const measurement = measure(allMessages, anchor);
      this.sampledSurfaceTokens.set(thread.id, measurement.surfaceTokens);

      // pressure（非 compactNow）阈值判定
      if (!opts.skipThreshold && trigger === 'pressure' && measurement.totalTokens < thresholdTokens) {
        return null;
      }

      const range = selectCompactableRange(
        candidate.turns.map((t) => ({ turnId: t.turnId, tokens: measure(t.messages).surfaceTokens })),
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
        removedTokens: range.headTokens,
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
    // shrink 基线 = 被归档口径（旧摘要 + head），与 selectCompactableRange 的 headTokens 一致
    const headTokens = measure(head).surfaceTokens + (oldSummary ? estimateMessage(oldSummary) : 0);

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
        const reader = stream.getReader();
        while (true) {
          const { done, value: part } = await reader.read();
          if (done) break;
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
    if (estimateMessage({ role: 'system', content: framed }) >= headTokens) {
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
