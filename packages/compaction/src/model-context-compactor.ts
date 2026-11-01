// @vico/compaction — ModelContextCompactor 默认实现（持久化增量滚动压缩）
import type {AgentMessage, Thread, ThreadStore, Turn} from '@vico/thread';
import type {ModelConfig} from '@vico/model';
import {createLanguageModel, ModelClient} from '@vico/model';
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

/** 可参与压缩的完结态 turn（对齐业务「完结 = completed/failed/aborted」） */
const FINAL_TURN_STATUSES = new Set<Turn['status']>(['completed', 'failed', 'aborted']);

/** 摘要消息 framing */
function frameSummary(text: string): string {
  return `${CHECKPOINT_PREAMBLE}\n\n${SUMMARY_OPEN_TAG}\n${text}\n${SUMMARY_CLOSE_TAG}`;
}

/** 候选 surface：单个完结态 turn 的消息（含 store message id 供归档） */
interface CandidateTurn {
  turnId: string;
  messages: AgentMessage[];
  messageIds: string[];
}

/**
 * 持久化增量滚动压缩器。
 * 候选消息由调用方传入（不再自行查 store）；只压缩完结态 turn；append-only（先写摘要后归档）；per-thread KeyedMutex 互斥。
 */
export class ModelContextCompactor implements ContextCompactor {
  private readonly thread: ThreadStore;
  private readonly modelConfig?: ModelConfig;
  private readonly reservedCompletionTokens: number;
  private readonly settings: ResolvedCompactionSettings;

  private readonly locks = new KeyedMutex();
  private readonly busyThreads = new Set<string>();

  constructor(options: ModelContextCompactorOptions) {
    this.thread = options.thread;
    this.modelConfig = options.modelConfig;
    this.reservedCompletionTokens = options.maxTokens ?? 0;
    this.settings = resolveSettings(options.settings);
  }

  async compactIfNeeded(context: CompactionContext, trigger: CompactionTrigger): Promise<CompactionResult | null> {
    if (!this.settings.auto) return null;
    const thread = context.session.thread;
    return this.locks.run(thread.id, async () => {
      const candidate = await this.buildCandidate(context.messages);
      return this.compactLocked(thread, context.session.turn.id, context.modelClient, trigger, context.signal, candidate);
    });
  }

  async compactNow(thread: Thread, messages: AgentMessage[], modelClient: ModelClient, signal: AbortSignal): Promise<CompactionResult | null> {
    if (this.busyThreads.has(thread.id)) {
      throw new ManualCompactionError('busy', `compaction already in progress for thread ${thread.id}`);
    }
    return this.locks.run(thread.id, async () => {
      const candidate = await this.buildCandidate(messages);
      // 手动压缩无「当前 turn」：summary 挂到线程最新的完结态 turn（candidate 已按 createdAt 升序）
      const summaryTurnId = candidate.at(-1)?.turnId;
      if (!summaryTurnId) {
        throw new ManualCompactionError('no-final-turn', 'no completed/failed/aborted turn to attach summary');
      }
      return this.compactLocked(thread, summaryTurnId, modelClient, 'pressure', signal, candidate, { skipThreshold: true });
    });
  }

  // ── 内部 ──

  /**
   * 从传入消息构建候选 surface：提取 turnId → 批量查 Turn → 过滤完结态 → 按 turnId 分组。
   * 返回按 turn.createdAt 升序排列的候选 turn（最旧在前，供 selectCompactableRange 从头部切分）。
   */
  private async buildCandidate(messages: AgentMessage[]): Promise<CandidateTurn[]> {
    const turnIds = [...new Set(messages.map((m) => m.turnId))];
    if (turnIds.length === 0) return [];

    const turns = await this.thread.getTurns(turnIds);
    const finalTurns = new Map(
      turns.filter((t) => FINAL_TURN_STATUSES.has(t.status)).map((t) => [t.id, t]),
    );

    const byTurn = new Map<string, CandidateTurn>();
    for (const m of messages) {
      const turn = finalTurns.get(m.turnId);
      if (!turn) continue; // 非完结态 turn 的消息不参与压缩
      let group = byTurn.get(m.turnId);
      if (!group) {
        group = { turnId: m.turnId, messages: [], messageIds: [] };
        byTurn.set(m.turnId, group);
      }
      group.messages.push(m);
      if (m.id) group.messageIds.push(m.id);
    }

    return [...byTurn.values()].sort(
      (a, b) => finalTurns.get(a.turnId)!.createdAt - finalTurns.get(b.turnId)!.createdAt,
    );
  }

  /** 锁内主流程（自动 / 手动共用），candidate 已由调用方按来源构建 */
  private async compactLocked(
    thread: Thread,
    summaryTurnId: string,
    modelClient: ModelClient,
    trigger: CompactionTrigger,
    signal: AbortSignal,
    candidate: CandidateTurn[],
    opts: { skipThreshold?: boolean } = {},
  ): Promise<CompactionResult | null> {
    this.busyThreads.add(thread.id);
    try {
      if (candidate.length === 0) return null;

      const { retainTokens, thresholdTokens } = this.resolveSpec(trigger);
      const allMessages = candidate.flatMap((t) => t.messages);
      const totalTokens = measure(allMessages);

      // pressure（非 compactNow）阈值判定
      if (!opts.skipThreshold && trigger === 'pressure' && totalTokens < thresholdTokens) {
        return null;
      }

      const range = selectCompactableRange(
        candidate.map((t) => ({ turnId: t.turnId, tokens: estimateMessages(t.messages) })),
        0, // 旧摘要已作为普通消息归入对应 turn，无独立 summary token
        retainTokens,
      );
      if (!range) return null;

      const headTurns = candidate.filter((t) => range.headTurnIds.includes(t.turnId));
      const headMessages = headTurns.flatMap((t) => t.messages);
      const headMessageIds = headTurns.flatMap((t) => t.messageIds);

      // 增量摘要（旧摘要作为 head 普通消息一并参与压缩；空输出 / shrink check 不通过返回 null）
      const summaryText = await this.summarize(headMessages, modelClient, signal);
      if (signal.aborted) return null; // cancelled
      if (summaryText === null) return null; // 摘要不合格：不写、不归档（spec §10），下次 turn 再试

      // append-only 落库：先写新摘要，再归档 head（先写后删，崩溃不丢上下文）
      const summaryEntry = {
        threadId: thread.id,
        turnId: summaryTurnId,
        role: SUMMARY_ROLE,
        content: summaryText,
        metadata: { kind: SUMMARY_METADATA_KIND },
      };
      const [created] = await this.thread.appendEntries([summaryEntry]);
      await this.thread.archiveMessages(thread.id, headMessageIds);

      return {
        summaryMessageId: created.id,
        // 内存消息链中的摘要按 user 角色注入（与 toModelMessages 的 summary→user 映射一致）
        summary: { id: created.id, role: 'user', content: summaryText, turnId: summaryTurnId },
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

  /**
   * 摘要：head 消息直接作为输入（旧摘要已含于其中）。
   * stream 调用异常直接抛出（由调用方决定处理）；空输出 / shrink check 不通过时返回 null——
   * 调用方 no-op，不写摘要、不归档（spec §10）。
   */
  private async summarize(head: AgentMessage[], modelClient: ModelClient, signal: AbortSignal): Promise<string | null> {
    const client = this.resolveSummaryClient(modelClient);
    const headTokens = estimateMessages(head);

    // 摘要调用失败直接抛出，不重试
    const result = await client.stream({
      system: COMPACTION_INSTRUCTION,
      messages: head,
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
