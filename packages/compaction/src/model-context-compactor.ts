// @vico/compaction — ModelContextCompactor 默认实现（持久化增量滚动压缩）
import type {ModelMessage} from 'ai';
import type {PersistableMessage, Thread, ThreadStore} from '@vico/thread';
import {toModelMessages} from '@vico/thread';
import type {ModelConfig} from '@vico/model';
import {createLanguageModel, getMessageText, ModelClient} from '@vico/model';
import {KeyedMutex} from '@vico/utils';
import {estimateMessage, estimateMessages, measure} from './token-estimator.js';
import {
  resolveCompactSpec,
  type ResolvedCompactionSettings,
  resolveSettings,
  selectCompactableRange,
} from './compaction-config.js';
import type {CompactionContext, CompactionResult, CompactionTrigger, ContextCompactor, ModelContextCompactorOptions} from './types.js';
import {ManualCompactionError, TargetPressureConfigError} from './errors.js';
import {CHECKPOINT_PREAMBLE, COMPACTION_INSTRUCTION, SUMMARY_CLOSE_TAG, SUMMARY_OPEN_TAG} from './prompts.js';

/** 摘要消息固定 role 与 metadata 标识 */
const SUMMARY_ROLE = 'summary';
const SUMMARY_METADATA_KIND = 'compaction-summary';

/** 摘要消息 framing */
function frameSummary(text: string): string {
  return `${CHECKPOINT_PREAMBLE}\n\n${SUMMARY_OPEN_TAG}\n${text}\n${SUMMARY_CLOSE_TAG}`;
}

/** 候选 surface 段：摘要（可空）+ 各已完成 turn 消息 */
interface CandidateTurn { turnId: string; messages: PersistableMessage[]; messageIds: string[] }
interface Candidate {
  summary: PersistableMessage | null;
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

  constructor(options: ModelContextCompactorOptions) {
    this.thread = options.thread;
    this.conversationWindow = options.conversationWindow;
    this.modelConfig = options.modelConfig;
    this.reservedCompletionTokens = options.maxTokens ?? 0;
    this.settings = resolveSettings(options.settings);
  }

  async compactIfNeeded(context: CompactionContext, trigger: CompactionTrigger): Promise<CompactionResult | null> {
    if (!this.settings.auto) return null;
    const thread = context.session.thread;
    return this.locks.run(thread.id, () => this.compactFromContext(context, trigger));
  }

  async compactNow(thread: Thread, modelClient: ModelClient, signal: AbortSignal): Promise<CompactionResult | null> {
    if (this.busyThreads.has(thread.id)) {
      throw new ManualCompactionError('busy', `compaction already in progress for thread ${thread.id}`);
    }
    return this.locks.run(thread.id, async () => {
      const candidate = await this.loadCandidate(thread);
      return this.compactLocked(thread, modelClient, 'pressure', signal, candidate, { skipThreshold: true });
    });
  }

  // ── 内部 ──

  /** 自动压缩入口（pressure / context-overflow）：以 TurnContext 内存消息链为压缩 surface */
  private async compactFromContext(context: CompactionContext, trigger: CompactionTrigger): Promise<CompactionResult | null> {
    const thread = context.session.thread;
    const candidate = await this.loadCandidateFromContext(context);
    return this.compactLocked(thread, context.modelClient, trigger, context.signal, candidate);
  }

  /** 锁内主流程（自动 / 手动共用），candidate 已由调用方按来源构建 */
  private async compactLocked(thread: Thread, modelClient: ModelClient, trigger: CompactionTrigger, signal: AbortSignal, candidate: Candidate, opts: { skipThreshold?: boolean } = {}): Promise<CompactionResult | null> {
    this.busyThreads.add(thread.id);
    try {
      if (candidate.turns.length === 0) return null;

      const { retainTokens, thresholdTokens } = this.resolveSpec(trigger);
      const allMessages: PersistableMessage[] = [
        ...(candidate.summary ? [candidate.summary] : []),
        ...candidate.turns.flatMap((t) => t.messages),
      ];
      const totalTokens = measure(allMessages);

      // pressure（非 compactNow）阈值判定
      if (!opts.skipThreshold && trigger === 'pressure' && totalTokens < thresholdTokens) {
        return null;
      }

      const range = selectCompactableRange(
        candidate.turns.map((t) => ({ turnId: t.turnId, tokens: estimateMessages(t.messages) })),
        candidate.summary ? estimateMessage(candidate.summary) : 0,
        retainTokens,
      );
      if (!range) return null;

      const headTurns = candidate.turns.filter((t) => range.headTurnIds.includes(t.turnId));
      const headMessages = headTurns.flatMap((t) => t.messages);
      const headMessageIds = headTurns.flatMap((t) => t.messageIds);

      // 增量摘要（stream 异常直接抛出；空输出 / shrink check 不通过返回 null）
      const summaryText = await this.summarize(headMessages, candidate.summary, modelClient, signal);
      if (signal.aborted) return null; // cancelled
      if (summaryText === null) return null; // 摘要不合格：不写、不归档（spec §10），下次 turn 再试

      // append-only 落库：先写新摘要，再归档旧摘要 + head（先写后删，崩溃不丢上下文）
      const summaryEntry = {
        threadId: thread.id,
        turnId: thread.id, // 摘要不属于任何 turn，用 thread.id 作哨兵
        role: SUMMARY_ROLE,
        content: summaryText,
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
   * 从 TurnContext 内存消息链构建候选 surface：前 historyCount 条历史前缀与
   * store 非归档条目按 created_at 升序一一对应（消息内容取内存副本，id/turnId 取 store 条目）。
   */
  private async loadCandidateFromContext(context: CompactionContext): Promise<Candidate> {
    const thread = context.session.thread;
    const history = context.messages.slice(0, context.historyCount);
    const entries = await this.thread.getEntries(thread.id, { includeArchived: false });
    const historyEntries = entries.slice(0, context.historyCount);

    const turns = new Map<string, CandidateTurn>();
    let summary: PersistableMessage | null = null;
    let summaryEntryId: string | undefined;

    for (let i = 0; i < history.length; i++) {
      const entry = historyEntries[i];
      if (!entry) continue; // 防御：store 条目少于内存历史时跳过

      if (entry.role === 'summary') {
        summary = history[i];
        summaryEntryId = entry.id;
        continue;
      }

      let group = turns.get(entry.turnId);
      if (!group) {
        group = { turnId: entry.turnId, messages: [], messageIds: [] };
        turns.set(entry.turnId, group);
      }
      group.messages.push(history[i]);
      group.messageIds.push(entry.id);
    }

    return { summary, summaryEntryId, turns: [...turns.values()] };
  }

  /**
   * 增量摘要：独立摘要模型（若配置）或复用传入 modelClient。
   * stream 调用异常直接抛出（由调用方决定处理）；空输出 / shrink check 不通过时返回 null——
   * 调用方 no-op，不写摘要、不归档（spec §10）。
   */
  private async summarize(head: PersistableMessage[], oldSummary: PersistableMessage | null, modelClient: ModelClient, signal: AbortSignal): Promise<string | null> {
    const client = this.resolveSummaryClient(modelClient);
    // shrink 基线 = 被归档口径（旧摘要 + head），与 selectCompactableRange 的 headTokens 一致
    const headTokens = estimateMessages(head) + (oldSummary ? estimateMessage(oldSummary) : 0);

    // 摘要输入：旧摘要折叠进新摘要（以 system 角色传入——summary 非 provider 可识别角色，避免 standardizePrompt 拒绝）
    const input: ModelMessage[] = [];
    if (oldSummary) input.push({ role: 'system', content: getMessageText(oldSummary) });
    input.push(...head);

    // 摘要调用失败直接抛出，不重试
    const result = await client.stream({
      system: COMPACTION_INSTRUCTION,
      messages: input,
      maxOutputTokens: this.settings.maxTokens,
      temperature: 0,
      abortSignal: signal,
    });
    const text = await result.text();

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
