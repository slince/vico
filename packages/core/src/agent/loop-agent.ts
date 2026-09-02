// @vico/core - LoopAgent: Agent 默认实现，驱动单个 turn 的 model→tool→repeat 循环
import {randomUUID} from 'node:crypto';
import type {Logger} from 'pino';
import pino from 'pino';
import type {LanguageModelV4} from '@ai-sdk/provider';
import type {ModelMessage, TextStreamPart, ToolSet} from 'ai';

import type {Agent, AgentOptions, CreateThreadOptions} from './agent.js';
import type {TurnEvent, UsageMetrics} from './types.js';
import type {ApprovalDecider, Tool, ToolCall, ToolResult} from '../tool/types.js';
import type {Skill} from '../skill/types.js';
import type {MemoryStore} from '../memory/memory-store.js';
import type {Thread, ThreadMetadata, ThreadStore} from '../thread/thread-store.js';
import type {EventPayload, EventRecorder, EventType} from '../events/types.js';
import type {UserMessage} from '../stream/types.js';
import type {ModelRequest, ReasoningEffort} from '../model/types.js';
import type {ContextCompactor} from './context-compactor.js';
import type {TokenEconomy} from './token-economy.js';
import type {Checkpoint, CheckpointStore} from './checkpoint.js';
import type {ContextProcessor} from './context-processors/context-processor.js';
import {ProcessorPipeline} from './context-processors/context-processor.js';
import type {
  ApprovalClassification,
  CallModelResult,
  ModelStepResult,
  RunOptions,
  Step,
  StepLoopResult,
  ToolApproval,
  ToolCallApproval,
  TurnContext,
  TurnResult,
  TurnSession,
} from './loop-agent-options.js';

import {ModelClient} from '../model/model-client.js';
import {composeResolvers, defaultApprovalResolvers} from '../tool/policy-helpers.js';
import {diffRemaining, findUnpairedToolCalls, normalizeUserMessage} from './utils.js';
import {fromModelMessage, toModelMessages} from '../thread/utils.js';
import {TurnOutput} from './turn-output.js';
import {finishPart, toolApprovalRequestPart, toolApprovalResponsePart, toolOutputDeniedPart,} from './stream-parts.js';
import {buildAssistantMessage, buildToolResultMessage, extractApprovalResponses,} from '../model/message-utils.js';
import {ToolExecutor} from './tool-executor.js';
import {ModelStreamReader} from './stream-reader.js';
import {ModelRequestContext} from './context-processors/model-request-context.js';
import {SystemPromptProcessor} from './context-processors/system-prompt-processor.js';
import {SkillProcessor} from './context-processors/skill-processor.js';
import {MemoryProcessor} from './context-processors/memory-processor.js';
import {WorkspaceToolProcessor} from './context-processors/workspace-tool-processor.js';
import {KeyedMutex} from '../utils/async-keyed-lock.js';

/** LoopAgent 构造选项 */
export interface LoopAgentOptions extends AgentOptions {
  /** 上下文处理器，不传则使用默认管道 */
  processors?: ContextProcessor[];
}

/** 组装默认上下文处理器管道：系统提示词 + Skill 目录 + 工作区过滤 + 记忆 */
function createDefaultProcessors(skills: Skill[], memory: MemoryStore): ContextProcessor[] {
  return [
    new SystemPromptProcessor(),
    new SkillProcessor(skills),
    new WorkspaceToolProcessor(),
    new MemoryProcessor(memory),
  ];
}

/** LoopAgent — Agent 默认实现，编排 model→tool→repeat 循环 */
export class LoopAgent<TToolSet extends ToolSet = ToolSet>
  implements Agent {

  readonly id: string;
  readonly name: string;
  readonly systemPrompt: string;
  readonly model: LanguageModelV4;
  readonly modelClient: ModelClient;
  readonly temperature: number;
  readonly reasoning?: ReasoningEffort;
  readonly maxTokens?: number;
  readonly maxSteps: number;
  readonly skills: Skill[];
  readonly tools: Tool[];
  readonly memory: MemoryStore;
  readonly thread: ThreadStore;
  readonly approvalResolver: ApprovalDecider;
  readonly events: EventRecorder<TurnEvent>;
  readonly workspace?: string;
  readonly compactor?: ContextCompactor;
  readonly tokenEconomy?: TokenEconomy;
  readonly checkpointStore: CheckpointStore;
  readonly logger: Logger;

  private readonly toolExecutor: ToolExecutor<TToolSet>;
  private readonly pipeline: ProcessorPipeline;
  /** per-turn 恢复执行锁（防线①）：同一 turn 的并发恢复串行排队 */
  private readonly resumeMutex = new KeyedMutex();

  constructor(options: LoopAgentOptions) {
    const { processors, ...rest } = options;
    this.id = rest.id;
    this.name = rest.name;
    this.systemPrompt = rest.systemPrompt;
    this.model = rest.model;
    this.modelClient = new ModelClient(rest.model);
    this.temperature = rest.temperature;
    this.reasoning = rest.reasoning;
    this.maxTokens = rest.maxTokens;
    this.maxSteps = rest.maxSteps;
    this.skills = rest.skills;
    this.tools = rest.tools;
    this.memory = rest.memory;
    this.thread = rest.thread;
    this.approvalResolver = rest.approvalResolver ?? composeResolvers(...defaultApprovalResolvers);
    this.events = rest.events;
    this.workspace = rest.workspace;
    this.compactor = rest.compactor;
    this.tokenEconomy = rest.tokenEconomy;
    this.checkpointStore = rest.checkpointStore;
    this.logger = rest.logger ?? pino();

    this.toolExecutor = new ToolExecutor({ tools: rest.tools, host: this });
    this.pipeline = new ProcessorPipeline(processors ?? createDefaultProcessors(rest.skills, rest.memory));
  }

  get log(): Logger {
    return this.logger;
  }

  /**
   * 订阅 turn 事件，委托给事件系统。
   *
   * @param event - 事件类型名称
   * @param handler - 事件处理函数
   */
  on<K extends EventType<TurnEvent>>(event: K, handler: (data: EventPayload<TurnEvent, K>) => void): void {
    this.events.on(event, handler);
  }

  /**
   * 取消订阅 turn 事件。
   *
   * @param event - 事件类型名称
   * @param handler - 要移除的事件处理函数
   */
  off<K extends EventType<TurnEvent>>(event: K, handler: (data: EventPayload<TurnEvent, K>) => void): void {
    this.events.off(event, handler);
  }

  /**
   * 创建新会话（Thread）。
   *
   * @param options - 会话配置（标题、用户、工作区、元数据）
   * @returns 新创建的 Thread
   */
  async createThread(options: CreateThreadOptions = {}): Promise<Thread> {
    const id = `${this.id}-${randomUUID()}`;
    const workspace = options.workspace ?? this.workspace;
    const metadata: ThreadMetadata = { ...options.metadata, workspace };
    const thread = await this.thread.createThread(this.id, options.title ?? 'New thread', id, {
      userId: options.userId,
      metadata,
    });
    this.log.debug({ threadId: id, agentId: this.id }, 'thread created');
    return thread;
  }

  /**
   * 发起一次对话：发送消息并等待返回最终结果（非流式）。
   *
   * @param message - 用户消息
   * @param options - 调用参数
   * @returns turn 最终结果
   */
  async invoke(message: UserMessage, options: RunOptions): Promise<TurnResult> {
    const output = await this.run(await normalizeUserMessage(message), options);
    return output.result;
  }

  /**
   * 流式对话 — 返回 TurnOutput，含 ReadableStream 流和 result Promise。
   *
   * @param message - 用户消息
   * @param options - turn 运行参数
   */
  async stream(message: UserMessage, options: RunOptions): Promise<TurnOutput> {
    return this.run(await normalizeUserMessage(message), options);
  }

  /**
   * 执行一个 turn，同步返回 TurnOutput（含 ReadableStream 流和 result Promise）。
   * 历史消息由 Memory 自动补充。外部通过 TurnOutput.abort() 终止。
   *
   * @param userMessages - 本轮输入消息组
   * @param options - turn 运行参数
   * @returns TurnOutput 实例，包含输出流和结果 Promise
   */
  private run(userMessages: ModelMessage[], options: RunOptions): TurnOutput {
    const { promise, resolve } = Promise.withResolvers<TurnResult>();

    const internalAc = new AbortController();

    const abort = () => {
      internalAc.abort();
    };

    const stream = new ReadableStream<TextStreamPart<TToolSet>>({
      start: async (controller) => {
        controller.enqueue({ type: 'start' });
        try {
          const result = await this.start({userMessages, signal: internalAc.signal, controller, thread: options.thread});
          resolve(result);
        } catch (err) {
          const error = err instanceof Error ? err : String(err);
          // 向流内透出错误 part（controller 可能已关闭，静默兜底）
          try { controller.enqueue({ type: 'error', error }); } catch { /* already closed */ }
          this.emit({ type: 'error', error });
          // 始终 resolve：错误已通过流透出，消费者无需 try-catch
          resolve({ status: 'failed', steps: 0, usage: { input: 0, output: 0 }, messages: [], error });
        } finally {
          try { controller.close(); } catch { /* already closed */ }
        }
      },
      cancel() {
        internalAc.abort();
      },
    });

    return new TurnOutput(stream, promise, abort);
  }

  /**
   * runTurn 的核心逻辑，由 ReadableStream 的 start 回调调用。
   * 自动检测 thread 中是否存在 paused turn，有则恢复执行，无则创建新 turn。
   */
  private async start(ctx: {
    userMessages: ModelMessage[];
    signal: AbortSignal;
    controller: ReadableStreamDefaultController<TextStreamPart<TToolSet>>;
    thread: Thread;
  }): Promise<TurnResult> {
    const { userMessages, signal, controller, thread } = ctx;

    const workspace = thread.metadata?.workspace ?? this.workspace;

    // 自动恢复所有未完成的 turn（paused/running/failed），前提是存在 checkpoint。
    // 整体包进 per-turn 锁，并在锁内重读最新版本，规避并发恢复 TOCTOU。
    const latestTurn = await this.thread.getLatestTurn(thread.id);
    if (latestTurn && latestTurn.status !== 'completed') {
      return this.resumeMutex.run(latestTurn.id, async () => {
        // 锁内重读 turn 状态：等待排队的第二个 start() 可能已错过 turn 完成，
        // 若已终态则降级为新建 turn，避免对已完成 turn 重复恢复执行。
        const turnNow = await this.thread.getTurn(latestTurn.id);
        const checkpoint = await this.checkpointStore.getLatest(latestTurn.id);
        if (!turnNow || turnNow.status === 'completed' || !checkpoint) {
          // 无 checkpoint 或已终态的 turn：降级为新建 turn
          const turn = await this.thread.createTurn(thread.id);
          const session: TurnSession = { workspace, thread, turn };
          return this.startTurn({ session, userMessages, signal, controller });
        }
        this.log.info({ turnId: latestTurn.id, threadId: thread.id, status: turnNow.status }, 'resuming turn');
        const session: TurnSession = { workspace, thread, turn: turnNow };
        return this.resumeTurn({ session, checkpoint, userMessages, signal, controller });
      });
    }

    // ── 正常新 turn ──
    const turn = await this.thread.createTurn(thread.id);
    const session: TurnSession = { workspace, thread, turn };
    return this.startTurn({ session, userMessages, signal, controller });
  }

  /** 创建新的 turn 并开始执行 */
  private async startTurn(params: {
    session: TurnSession;
    userMessages: ModelMessage[];
    signal: AbortSignal;
    controller: ReadableStreamDefaultController<TextStreamPart<TToolSet>>;
  }): Promise<TurnResult> {
    const { session, userMessages, signal, controller } = params;

    const usage: UsageMetrics = { input: 0, output: 0 };

    const approvedTools = new Map<string, ToolApproval>();
    this.loadSessionApprovals(session, approvedTools);

    const requestContext = new ModelRequestContext({agent: this, userMessages, tools: [...this.tools], session});
    await this.pipeline.enter(requestContext);

    // turn 开始时显式创建 checkpoint 初始版本（version=1），后续子步骤以 append 追加版本
    const checkpoint = await this.checkpointStore.create(session.turn.id, session.thread.id);

    // 本轮次的上下文对象
    const context: TurnContext<TToolSet> = { ctx: requestContext, messages: [...requestContext.messages], session, approvedTools, signal, controller, checkpoint };

    await this.persistMessages(context, userMessages);

    return this.startTurnLoop( 0, context, usage);
  }

  /** 从未完结的 turn 恢复执行，携带新的用户消息（审批决策从消息组中的原生 tool-approval-response part 解析） */
  private async resumeTurn(params: {
    session: TurnSession;
    checkpoint: Checkpoint;
    userMessages: ModelMessage[];
    signal: AbortSignal;
    controller: ReadableStreamDefaultController<TextStreamPart<TToolSet>>;
  }): Promise<TurnResult> {
    const { session, checkpoint, userMessages, signal, controller } = params;
    const { turn } = session;

    const usage: UsageMetrics = { input: 0, output: 0 };

    // 从本轮消息组解析审批决策（in-band 协议）：审批消息由引擎消费，剔除后其余消息进消息链
    const { decisions } = extractApprovalResponses(userMessages);

    // 恢复历史消息
    const entries = await this.thread.getEntriesByTurns([turn.id]);
    const messages = toModelMessages(entries);

    // ── 统一差集恢复的入口判定 ──
    // nextAction 显式标注恢复阶段：tool-approval=审批现场（消费决策后补跑）；tool-execution=计划版本（工具执行中途中断，差集补跑）。
    // 否则（model=推进版本：step 已正常完成）→ 防线② 消息链核对：未配对工具调用截断到该 assistant 消息之前，模型重新决策。
    const isApprovalResume = checkpoint.nextAction === 'tool-approval';
    const isPlanResume = checkpoint.nextAction === 'tool-execution';
    if (!isApprovalResume && !isPlanResume) {
      const unpaired = findUnpairedToolCalls(messages);
      if (unpaired) {
        this.log.info({ turnId: turn.id, unpaired: unpaired.unpairedCallIds }, 'unpaired tool calls, truncating chain for re-decision');
        messages.splice(unpaired.assistantIndex);
      }
    }

    // 构建 request context, 补全必要信息
    const requestContext = new ModelRequestContext({agent: this, messages, tools: this.tools, session});
    await this.pipeline.enter(requestContext);

    // ——— checkpoint 统一差集恢复 ———
    const approvedTools = new Map<string, ToolApproval>(Object.entries(checkpoint.approvedTools));
    this.loadSessionApprovals(session, approvedTools);
    const context: TurnContext<TToolSet> = { ctx: requestContext, messages: [...requestContext.messages], session, approvedTools, signal, controller, checkpoint };

    // 审批现场先消费 decisions：把暂停时的 pendingApprovalCalls 归类为「批准执行 / 拒绝落库」
    const { approvedCalls: newlyApproved, deniedResults: newlyDenied } = isApprovalResume
      ? await this.resolvePendingApprovals(checkpoint.pendingApprovalCalls, decisions, context)
      : { approvedCalls: [], deniedResults: [] };

    const planned = [...checkpoint.approvedCalls, ...newlyApproved];
    const toPersist = [...checkpoint.deniedResults, ...newlyDenied];
    const hasRecovery = planned.length > 0 || toPersist.length > 0;

    if (hasRecovery) {
      // 待执行清单 − 消息链中已完成（有 tool-result）= 需补跑；已执行的绝不重跑（异常重试恢复核心）
      const remaining = diffRemaining(planned, context.messages);
      this.log.info(
        { turnId: turn.id, planned: planned.map((c) => c.id), remaining: remaining.map((c) => c.id) },
        'resume: diff checkpoint plan vs completed tool calls',
      );
      if (remaining.length > 0) {
        const results = await this.toolExecutor.executeToolCalls(remaining, context);
        await this.appendToolResults([...results, ...toPersist], context);
      } else if (toPersist.length > 0) {
        await this.appendToolResults(toPersist, context);
      }
      // 恢复完成 → 追加推进版本（清单清空，nextAction='model'），latest 不再指向待补跑的计划版本
      context.checkpoint = await this.checkpointStore.append(turn.id, {
        parentId: checkpoint.id,
        stepIndex: checkpoint.stepIndex,
        nextAction: 'model',
        approvedTools: Object.fromEntries(context.approvedTools),
        pendingApprovalCalls: [],
        approvedCalls: [],
        deniedResults: [],
        lastMessageId: context.checkpoint.lastMessageId,
      });
    }

    await this.thread.updateTurn(turn.id, { status: 'running' });
    return this.startTurnLoop(context.checkpoint.stepIndex, context, usage);
  }

  /**
   * 消费审批决策：把暂停时的 pendingApprovalCalls 按 decisions 归类为「批准执行 / 拒绝落库」。
   * 回放审批决策到输出流（toolApprovalResponse / toolOutputDenied part），批准调用追踪 approvedTools（turn/session 级）。
   * 返回新批准的调用与拒绝结果（不含 checkpoint 中已有的 approvedCalls/deniedResults —— 由统一差集恢复一并处理）。
   */
  private async resolvePendingApprovals(
    pendingCalls: ToolCall[],
    decisions: ToolCallApproval[],
    context: TurnContext<TToolSet>,
  ): Promise<{ approvedCalls: ToolCall[]; deniedResults: ToolResult[] }> {
    const decisionMap = new Map(decisions.map((d) => [d.toolCallId, d]));
    const approvedCalls: ToolCall[] = [];
    const deniedResults: ToolResult[] = [];

    for (const pendingCall of pendingCalls) {
      const decision = decisionMap.get(pendingCall.id);
      const approved = decision?.approved ?? false;
      const scope = decision?.scope ?? 'turn';
      // 回放审批决策到输出流（恢复后的新流可见完整审批链路）
      context.controller.enqueue(toolApprovalResponsePart(pendingCall, approved, { scope }));
      if (approved) {
        approvedCalls.push(pendingCall);
        // 追踪到 approvedTools，确保同一 turn 后续 step 中该工具自动放行
        context.approvedTools.set(pendingCall.name, {
          approved: true,
          approvedAt: Date.now(),
        });
        // session 级审批：持久化到 thread.metadata，跨 turn 生效
        if (scope === 'session') {
          await this.saveSessionApproval(context, pendingCall.name);
        }
      } else {
        context.controller.enqueue(toolOutputDeniedPart(pendingCall));
        deniedResults.push({
          callId: pendingCall.id, name: pendingCall.name,
          status: 'error', output: null,
          error: 'Rejected by user',
        });
      }
    }

    return { approvedCalls, deniedResults };
  }

  /**
   * 执行 loop 并处理 finalize（pipeline.leave, updateTurn, tracer.finish）。
   */
  private async startTurnLoop(startStep: number, context: TurnContext<TToolSet>, usage: UsageMetrics): Promise<TurnResult> {

    const {session: {thread, turn}} = context
    const loopResult: StepLoopResult  = await this.runTurnLoop(startStep, context);
    usage.input += loopResult.usage.input;
    usage.output += loopResult.usage.output;

    // 暂停时不 finalize trace session，保留会话供恢复时复用
    if (loopResult.status === 'paused') {
      this.log.info({ turnId: turn.id, steps: loopResult.steps }, 'turn paused');
      // 暂停也关闭本次输出流，发终态 finish part（恢复执行走新的 run/流）
      context.controller.enqueue(finishPart('stop', usage));
      return {
        status: 'paused', steps: loopResult.steps, usage, messages: context.messages, thread, turn,
      };
    }

    await this.pipeline.leave(context.ctx);

    // 模型错误导致的失败
    if (loopResult.status === 'failed') {
      const err = loopResult.error!;
      await this.thread.updateTurn(turn.id, { status: 'failed', steps: loopResult.steps });
      await this.checkpointStore.append(turn.id, {
        parentId: context.checkpoint.id,
        stepIndex: loopResult.steps,
        nextAction: 'end',
        approvedTools: Object.fromEntries(context.approvedTools),
        pendingApprovalCalls: [],
        approvedCalls: [],
        deniedResults: [],
        lastMessageId: context.checkpoint.lastMessageId,
      });
      context.controller.enqueue(finishPart('error', usage));
      this.emit({ type: 'error', error: err });

      return {
        status: 'failed', steps: loopResult.steps, usage, messages: context.messages,
        thread, turn, error: loopResult.error,
      };
    }

    const status = loopResult.status === 'aborted' ? 'aborted' : 'completed';
    await this.thread.updateTurn(turn.id, { status, steps: loopResult.steps });

    // 终态进版本链（nextAction='end'），审计可见；版本链全量保留，不再 deleteByTurn
    await this.checkpointStore.append(turn.id, {
      parentId: context.checkpoint.id,
      stepIndex: loopResult.steps,
      nextAction: 'end',
      approvedTools: Object.fromEntries(context.approvedTools),
      pendingApprovalCalls: [],
      approvedCalls: [],
      deniedResults: [],
      lastMessageId: context.checkpoint.lastMessageId,
    });

    // 终态生命周期 part：中断先发 abort，再统一发 finish
    if (status === 'aborted') {
      context.controller.enqueue({ type: 'abort' });
    }
    context.controller.enqueue(finishPart(status === 'aborted' ? 'other' : 'stop', usage));
    this.emit({ type: 'done', usage });

    return {
      status: loopResult.status === 'aborted'
        ? (context.signal.aborted ? 'interrupted' : 'aborted')
        : 'completed',
      steps: loopResult.steps,
      usage,
      messages: context.messages,
      thread,
      turn,
    };
  }

  /**
   * 执行 step loop，被 startLoop（新 turn）和 startResume（恢复）共用。
   */
  private async runTurnLoop(startStep: number, context: TurnContext<TToolSet>): Promise<StepLoopResult> {
    const usage = { input: 0, output: 0 };
    let steps = startStep;

    const {session: {turn}, signal} = context

    while (steps < this.maxSteps && !signal.aborted) {
      const step: Step = { index: steps, messages: context.messages };
      const { action, pendingApprovalCalls, approvedCalls, deniedResults, usage: stepUsage, error } = await this.executeModelStep(step, context);
      usage.input += stepUsage.input;
      usage.output += stepUsage.output;

      if (action === 'pause') {
        // 暂停现场进版本树（nextAction='tool-approval'）
        context.checkpoint = await this.checkpointStore.append(turn.id, {
          parentId: context.checkpoint.id,
          stepIndex: steps,
          nextAction: 'tool-approval',
          approvedTools: Object.fromEntries(context.approvedTools),
          pendingApprovalCalls: pendingApprovalCalls ?? [],
          approvedCalls: approvedCalls ?? [],
          deniedResults: deniedResults ?? [],
          lastMessageId: context.checkpoint.lastMessageId,
        });
        await this.thread.updateTurn(turn.id, { status: 'paused', steps });
        return { status: 'paused', steps, usage };
      }

      if (action === 'break') {
        // 如果是因为模型错误 直接短路
        if (error) {
          return { status: 'failed', steps, usage, error };
        }
        break
      }

      // action === 'continue'
      // 决策后先落「计划版本」：本轮待执行的 approvedCalls / 待落库的 deniedResults 进 checkpoint，
      // 供工具执行中途中断/崩溃时按差集恢复补跑。确有内容才写，避免空清单版本冗余。
      if ((approvedCalls?.length ?? 0) > 0 || (deniedResults?.length ?? 0) > 0) {
        context.checkpoint = await this.checkpointStore.append(turn.id, {
          parentId: context.checkpoint.id,
          stepIndex: steps,
          nextAction: 'tool-execution',
          approvedTools: Object.fromEntries(context.approvedTools),
          pendingApprovalCalls: [],
          approvedCalls: approvedCalls ?? [],
          deniedResults: deniedResults ?? [],
          lastMessageId: context.checkpoint.lastMessageId,
        });
      }

      // 执行本轮 auto 批准的调用，拒绝结果一并落消息链（结果只落消息链，checkpoint 已留执行清单）
      const toolResults = await this.toolExecutor.executeToolCalls(approvedCalls ?? [], context);
      await this.appendToolResults([...toolResults, ...(deniedResults ?? [])], context);
      this.emit({ type: 'step-end', step: step.index + 1 });

      // step 完成 → 推进版本：清单清空，标志本轮决策执行完毕
      steps++;
      context.checkpoint = await this.checkpointStore.append(turn.id, {
        parentId: context.checkpoint.id,
        stepIndex: steps,
        nextAction: 'model',
        approvedTools: Object.fromEntries(context.approvedTools),
        pendingApprovalCalls: [],
        approvedCalls: [],
        deniedResults: [],
        lastMessageId: context.checkpoint.lastMessageId,
      });
    }

    return { status: signal.aborted ? 'aborted' : 'completed', steps, usage };
  }

  /**
   * 执行一个 model step 的模型侧流程：压缩 → model 调用 → 审批分类。
   *
   * 职责边界：本方法只负责「生成 + 分类」，不直接执行工具。工具执行与结果持久化
   * 由 runTurnLoop 在 append「计划版本」后进行（每 step 双写：计划 + 推进），以便工具
   * 执行中途中断/崩溃时可按「checkpoint 清单 − 消息链已完成」差集恢复补跑。
   *
   * @param step 当前步骤对象（携带 index 与消息链）
   * @param context 本 turn 的共享上下文（消息、审批状态、中断信号、流控制器、checkpoint）
   * @returns 步骤结果，action 三态：
   *   - `break`：token 耗尽 / 模型出错 / 已中止 / 无工具调用，终止循环
   *   - `pause`：存在待审批工具，暂停 turn 等待客户端审批（附 pendingApprovalCalls）
   *   - `continue`：工具已审批通过，交由 runTurnLoop 落「计划版本」后执行
   */
  private async executeModelStep(step: Step, context: TurnContext<TToolSet>): Promise<ModelStepResult> {
    this.emit({ type: 'step-start', step: step.index + 1 });

    const usage = { input: 0, output: 0 };

    await this.tryCompact(step, context.signal);

    if (this.tokenEconomy?.isInputExhausted()) {
      this.emit({ type: 'error', error: '输入 token 预算已耗尽' });
      return { action: 'break', usage };
    }

    if (this.tokenEconomy?.isOutputExhausted()) {
      this.emit({ type: 'error', error: '输出 token 预算已耗尽' });
      return { action: 'break', usage };
    }

    const modelResult = await this.callModel(step, context);

    // 如果模型调用出错，提前结束
    if (modelResult.error) {
      return { action: 'break', usage, error: modelResult.error };
    }

    // 模型返回后检查中断信号，避免在已取消的 turn 中继续执行工具
    if (context.signal.aborted) {
      return { action: 'break', usage };
    }

    usage.input += modelResult.usage.input;
    usage.output += modelResult.usage.output;
    this.tokenEconomy?.track(modelResult.usage.input, modelResult.usage.output);

    // 模型输出后的消息处理（text + tool-call parts 组装为原生 assistant 消息）
    if (modelResult.text || modelResult.toolCalls.length > 0) {
      const assistantMsg = buildAssistantMessage(modelResult.text, modelResult.toolCalls, modelResult.reasoning);
      context.messages.push(assistantMsg);

      await this.persistMessages(context, [assistantMsg]);
    }

    if (modelResult.toolCalls.length === 0) {
      this.emit({ type: 'step-end', step: step.index + 1 });
      return { action: 'break', usage };
    }

    // 审批 + 执行 + 持久化
    const { approvedCalls, deniedResults, pendingApprovalCalls } = await this.resolveToolApprovals(modelResult.toolCalls, context);
    // 有待审批的工具 → 暂停 turn
    // 因为未决的 tool_use 不能出现在发给模型的后续请求中
    if (pendingApprovalCalls.length > 0) {
      this.emit({ type: 'step-end', step: step.index + 1 });
      return { action: 'pause', pendingApprovalCalls, approvedCalls, deniedResults, usage };
    }

    // 已批准的调用不再在此执行——审批分类结果返回 runTurnLoop：先落「计划版本」清单再执行，
    // 使工具执行中途中断/崩溃时可按「checkpoint 清单 − 消息链已完成」差集恢复补跑。
    return { action: 'continue', approvedCalls, deniedResults, usage };
  }

  /**
   * 解析工具审批：遍历 toolCalls，按策略分类为 approvedCalls / deniedResults / pendingApprovalCalls。
   */
  private async resolveToolApprovals(toolCalls: ToolCall[], context: TurnContext<TToolSet>): Promise<ApprovalClassification> {
    const approvedCalls: ToolCall[] = [];
    const deniedResults: ToolResult[] = [];
    const pendingApprovalCalls: ToolCall[] = [];

    for (const call of toolCalls) {
      const tool = this.toolExecutor.findTool(call.name);
      const policy = tool?.policy ?? 'auto';

      const isFirstUse = !context.approvedTools.has(call.name);
      const wasApproved = context.approvedTools.get(call.name)?.approved ?? false;

      // 工具未注册 → 直接拒绝
      if (!tool) {
        deniedResults.push({
          callId: call.id, name: call.name,
          status: 'error', output: null,
          error: `Tool "${call.name}" 未找到`,
        });
        context.controller.enqueue(toolOutputDeniedPart(call));
        continue;
      }

      const decision = await this.approvalResolver(call, tool, policy, {
        firstUse: isFirstUse,
        previousApproved: wasApproved,
        toolArgs: call.args,
        workspace: context.session.workspace,
      });

      switch (decision.status) {
        case 'approved': {
          context.approvedTools.set(call.name, {
            approved: true,
            approvedAt: Date.now(),
          });
          if (decision.suggested) {
            this.emit({
              type: 'tool-suggested',
              toolCallId: call.id,
              toolName: call.name,
              input: call.args,
            });
          }
          approvedCalls.push(call);
          break;
        }
        case 'paused': {
          context.controller.enqueue(toolApprovalRequestPart(call));
          this.emit({
            type: 'tool-approval-request',
            approvalId: call.id,
            toolCallId: call.id,
            toolName: call.name,
            input: call.args,
          });
          pendingApprovalCalls.push(call);
          break;
        }
        case 'denied': {
          deniedResults.push({
            callId: call.id, name: call.name,
            status: 'error', output: null,
            error: decision.reason ?? '被策略阻止',
          });
          context.controller.enqueue(toolOutputDeniedPart(call));
          break;
        }
      }
    }

    return { approvedCalls, deniedResults, pendingApprovalCalls };
  }

  /**
   * 持久化 session 级工具审批到 thread.metadata。
   */
  private async saveSessionApproval(context: TurnContext<TToolSet>, toolName: string): Promise<void> {
    const meta = context.session.thread.metadata ?? {};
    meta.sessionApprovedTools ??= {};
    meta.sessionApprovedTools[toolName] = { approvedAt: Date.now() };
    await this.thread.updateThread(context.session.thread.id, { metadata: meta });
  }

  /**
   * 从 thread.metadata 加载 session 级审批，预填入 approvedTools Map。
   */
  private loadSessionApprovals(session: TurnSession, approvedTools: Map<string, ToolApproval>): void {
    const sessionApproved = session.thread.metadata?.sessionApprovedTools;
    if (!sessionApproved) return;
    for (const [name, entry] of Object.entries(sessionApproved)) {
      approvedTools.set(name, { approved: true, approvedAt: entry.approvedAt });
    }
  }

  /**
   * 批量持久化消息到 threadStore。
   */
  async persistMessages(context: TurnContext<TToolSet>, messages: ModelMessage[]): Promise<void> {
    if (messages.length === 0) {
      return
    }

    const threadId = context.session.thread.id;
    const turnId = context.session.turn.id;
    const created = await this.thread.appendEntries(
      messages.map(message => ({ threadId, turnId, ...fromModelMessage(message) })),
    );
    // 记录最后一条消息 id，供 fork 时截断消息链精确定位
    const last = created.at(-1);
    if (last) {
      context.checkpoint.lastMessageId = last.id;
    }
  }

  /**
   * 发射事件到订阅者（箭头函数绑定 this，可直接作为回调传递）。
   */
  emit = (event: TurnEvent): void => {
    this.events.emit(event);
  };

  /** 工具结果 → 原生 tool 消息 + 批量持久化 */
  async appendToolResults(toolResults: ToolResult[], context: TurnContext<TToolSet>): Promise<void> {
    if (toolResults.length === 0) {
      return
    }
    const messages: ModelMessage[] = [];

    for (const r of toolResults) {
      const message = buildToolResultMessage(r);
      context.messages.push(message);
      messages.push(message);
    }

    await this.persistMessages(context, messages);
  }

  /**
   * 压缩检查，按需原地替换 messages。
   */
  private async tryCompact(step: Step, signal: AbortSignal): Promise<void> {
    if (!this.compactor) return;
    const result = await this.compactor.compactIfNeeded(step.messages, this.modelClient, signal);
    if (result.wasCompacted) {
      step.messages.length = 0;
      step.messages.push(...result.compacted);
      this.emit({ type: 'compacted', removedTokens: result.removedTokens });
    }
  }

  /**
   * 单次模型调用。messages 已由调用方预处理（含 ctx.before/after），
   * 不修改入参，结果通过 CallModelResult 返回。
   */
  private async callModel(step: Step, context: TurnContext<TToolSet>): Promise<CallModelResult> {
    const { ctx, controller } = context;

    const request: ModelRequest = {
      system: ctx.getSystemPrompt(),
      messages: step.messages,
      tools: ctx.tools,
      maxOutputTokens: this.maxTokens,
      temperature: this.temperature,
      reasoning: this.reasoning,
    };

    const resolveError = (error: Error | string): CallModelResult => {
      this.emit({ type: 'error', error });
      controller.enqueue({ type: 'error', error });
      return { text: '', toolCalls: [], usage: { input: 0, output: 0 }, error };
    };

    try {
      const {stream} = await this.modelClient.stream(request, context.signal);
      const reader = new ModelStreamReader<TToolSet>({
        controller,
        emit: this.emit,
        request: request,
      });

      return reader.read(stream);
    } catch (e) {
      const err = e instanceof Error ? e as Error: new Error(String(e));
      return resolveError(err);
    }
  }
}
