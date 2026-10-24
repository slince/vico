// @vico/agent - LoopAgent: Agent 默认实现，驱动单个 turn 的 model→tool→repeat 循环
import {randomUUID} from 'node:crypto';
import type {Logger} from 'pino';
import pino from 'pino';
import type {ModelMessage, TextStreamPart, ToolSet} from 'ai';

import type {Agent, AgentOptions, CreateThreadOptions} from './agent.js';
import type {ModelRequest, ReasoningEffort} from '@vico/model';
import {
  buildAssistantMessage,
  buildToolResultMessage,
  completedCallIds,
  createLanguageModel,
  ensureToolCallConsistency,
  extractApprovalResponses,
  isLanguageModel,
  ModelClient,
  type ModelRef
} from '@vico/model';
import type {ApprovalDecider, ApprovalMode, Tool, ToolCall, ToolResult} from '@vico/tool';
import {composeResolvers, defaultApprovalResolvers, ToolExecutor} from '@vico/tool';
import type {Skill} from '@vico/skill';
import type {MemoryStore} from '@vico/memory';
import type {Thread, ThreadMetadata, ThreadStore, TurnSession, TurnStep} from '@vico/thread';
import {fromModelMessage, type MessageWithUsage} from '@vico/thread';
import type {ToolApproval} from '@vico/types';
import type {EventPayload, EventRecorder, EventType} from '@vico/events';
import type {CallModelResult, UserMessage} from '@vico/stream';
import {
  addUsage,
  createModelStreamTransformer,
  emptyUsage,
  finishPart,
  toolApprovalRequestPart,
  toolApprovalResponsePart,
  toolOutputDeniedPart,
  toolResultPart
} from '@vico/stream';
import {type CompactionResult, type ContextCompactor, isContextOverflowError} from '@vico/compaction';
import type {Checkpoint, CheckpointApprovalCalls, CheckpointStore, NextAction} from '@vico/checkpoint';
import {forwardToController, Pipeline} from '@vico/utils';
import type {ContextProcessor} from '@vico/context';
import {ModelRequestContext} from '@vico/context';
import type {
  ModelStepResult,
  ResolvedApprovals,
  RunOptions,
  StepLoopResult,
  TurnContext,
  TurnResult,
} from './loop-agent-options.js';
import {createDefaultProcessors, normalizeUserMessage} from './utils.js';
import {TurnOutput} from './turn-output.js';

/** LoopAgent 构造选项 */
export interface LoopAgentOptions extends AgentOptions {
  /** 上下文处理器，不传则使用默认管道 */
  processors?: ContextProcessor[];
}

/** LoopAgent — Agent 默认实现，编排 model→tool→repeat 循环 */
export class LoopAgent<TToolSet extends ToolSet = ToolSet>
  implements Agent {

  readonly id: string;
  readonly name: string;
  readonly systemPrompt: string;
  readonly modelClient: ModelClient;
  /** 原始模型引用（LanguageModel 实例或 ModelConfig 配置），run 级仅切换模型名时复用 */
  readonly model: ModelRef;
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
  readonly checkpointStore: CheckpointStore;
  readonly logger: Logger;

  private readonly toolExecutor: ToolExecutor;
  private readonly contextProcessors: Pipeline<ModelRequestContext>;
  /** run 级覆盖模型客户端（key 为模型名），复用已构建实例，避免重复 createLanguageModel/new */
  private readonly modelOverrides = new Map<string, ModelClient>();

  constructor(options: LoopAgentOptions) {
    const { processors, ...rest } = options;
    this.id = rest.id;
    this.name = rest.name;
    this.systemPrompt = rest.systemPrompt;
    this.model = rest.model;

    // 构建大语言模型
    const languageModel = isLanguageModel(rest.model) ? rest.model : createLanguageModel(rest.model)
    this.modelClient = new ModelClient(languageModel);

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
    this.checkpointStore = rest.checkpointStore;
    this.logger = rest.logger ?? pino();

    this.toolExecutor = new ToolExecutor({ tools: rest.tools });
    this.contextProcessors = new Pipeline<ModelRequestContext>().use(...(processors ?? createDefaultProcessors(rest.skills, rest.memory)));
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
    const output = this.run(await normalizeUserMessage(message), options);
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
          const result = await this.start({
            userMessages,
            signal: internalAc.signal,
            controller,
            thread: options.thread,
            reasoning: options.reasoning,
            modelClient: this.resolveModelClient(options.model),
            // 透传给各 resolver 的审批政策模式（由默认链中的 approvalModeResolver 处理）
            approvalMode: options.approvalMode,
          });
          resolve(result);
        } catch (err) {
          const error = err instanceof Error ? err : String(err);
          // 向流内透出错误 part（controller 可能已关闭，静默兜底）
          try { controller.enqueue({ type: 'error', error }); } catch { /* already closed */ }
          this.emit({ type: 'error', error });
          // 始终 resolve：错误已通过流透出，消费者无需 try-catch
          resolve({ status: 'failed', steps: 0, usage: emptyUsage(), messages: [], error });
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
   * 解析本次 run 使用的 ModelClient。
   *
   * 仅切换模型名，provider/apiKey/baseUrl 复用 agent 原始 ModelConfig；
   * 未传模型名时回退默认 modelClient。
   * agent 由 LanguageModel 实例构建时无法重建模型：切换到自身 modelId 视为不切换，
   * 切换到其它模型名则直接报错。
   *
   * @param modelName - run 级模型名（可选）
   * @returns 本次 run 使用的模型客户端
   */
  private resolveModelClient(modelName?: string): ModelClient {
    if (!modelName) {
      return this.modelClient;
    }
    if (isLanguageModel(this.model)) {
      if (modelName !== this.model.modelId) {
        throw new Error(`Cannot switch to model "${modelName}": this agent was built from a LanguageModel instance and only supports its own model "${this.model.modelId}"`);
      }
      return this.modelClient;
    }

    const cached = this.modelOverrides.get(modelName);
    if (cached) {
      return cached;
    }
    const model = createLanguageModel({ ...this.model, model: modelName });
    const modelClient = new ModelClient(model);
    this.modelOverrides.set(modelName, modelClient);
    return modelClient;
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
    reasoning?: ReasoningEffort;
    modelClient: ModelClient;
    approvalMode?: ApprovalMode;
  }): Promise<TurnResult> {
    const { userMessages, signal, controller, thread, reasoning, modelClient, approvalMode } = ctx;

    const workspace = thread.metadata?.workspace ?? this.workspace;

    // 自动恢复所有未完成的 turn（paused/running/failed），前提是存在 checkpoint。
    // 整体包进 per-turn 锁，并在锁内重读最新版本，规避并发恢复 TOCTOU。
    const latestTurn = await this.thread.getLatestTurn(thread.id);
    let turn;
    let checkpoint;
    if (latestTurn && latestTurn.status !== 'completed') {
      turn = latestTurn;
      checkpoint = await this.checkpointStore.getLatest(latestTurn.id)
    } else {
      // ── 正常新 turn ── 历史压力压缩（只压缩已完成 turn，在创建 turn / 注入历史前）
      await this.compactForPressure(thread, modelClient, signal);
      turn = await this.thread.createTurn(thread.id);
    }

    if (!checkpoint) {
      // turn 开始时显式创建 checkpoint 初始版本（version=1），后续子步骤以 append 追加版本
       checkpoint = await this.checkpointStore.create(turn.id, thread.id);
    }

    const session: TurnSession = { workspace, thread, turn };
    return this.startTurn({ session, userMessages, signal, controller, checkpoint, reasoning, modelClient, approvalMode });
  }

  /** 创建新的 turn 并开始执行 */
  private async startTurn(params: {
    session: TurnSession;
    userMessages: ModelMessage[];
    signal: AbortSignal;
    controller: ReadableStreamDefaultController<TextStreamPart<TToolSet>>;
    checkpoint: Checkpoint;
    reasoning?: ReasoningEffort;
    modelClient: ModelClient;
    approvalMode?: ApprovalMode;
  }): Promise<TurnResult> {
    const { session, userMessages, signal, controller, checkpoint, reasoning, modelClient, approvalMode } = params;

    const {decisions} = extractApprovalResponses(userMessages)

    const userMessageCount = userMessages.length;
    const requestContext = new ModelRequestContext({agent: this, userMessages, tools: this.tools, session});

    // 洋葱执行：各处理器前置注入（enter 段）→ 核心（构建 TurnContext + runLoop）→ 逆序后置（resolve 段）。
    // 核心产物经闭包传出；resolve 段跑完后统一交给 finalizeTurn 收尾（落库 + 流终结）。
    let context: TurnContext<TToolSet>;
    let loopResult: StepLoopResult;
    await this.contextProcessors.execute(requestContext, async () => {
      // 历史由 MemoryProcessor unshift 注入；记录条数供 context-overflow 压缩后重建内存历史前缀
      const historyCount = requestContext.messages.length - userMessageCount;

      // 本轮次的上下文对象
      context = {
        ctx: requestContext,
        messages: [...requestContext.messages],
        decisions: decisions,
        approvedTools: new Map<string, ToolApproval>(),
        session,
        signal,
        controller,
        checkpoint,
        // 恢复暂停的 turn 时从 metadata.usage 读回已累计用量，跨暂停不丢量
        usage: session.turn.metadata?.usage ?? emptyUsage(),
        reasoning,
        modelClient,
        approvalMode,
        historyCount,
      };

      // 从 session 加载会话配置
      this.loadSessionApprovals(session, context);

      // 保存本轮会话消息
      await this.persistMessages(context, userMessages);

      loopResult = await this.runLoop(context);

      // 非暂停（完结/失败/中止）时标记完结，resolve 类后置处理据此执行；暂停等待审批则不落情景记忆
      if (loopResult.status !== 'paused') {
        context.ctx.completed = true;
      }
    });

    return this.finalizeTurn(context!, loopResult!);
  }

  /**
   * loop 结束后的收尾：按结果状态落库、终结输出流并返回最终 TurnResult。
   *
   * 注意：resolve 类后置处理（如情景记忆落库）已由洋葱 unwind 在 execute 中跑完，
   * 本方法只负责「落库 + 流终结」，保证 finish part 是流内最后一个事件。
   */
  private async finalizeTurn(context: TurnContext<TToolSet>, result: StepLoopResult): Promise<TurnResult> {

    const {session: {thread, turn}} = context
    const usage = addUsage(context.usage, result.usage);

    // 暂停时不 finalize trace session，保留会话供恢复时复用
    if (result.status === 'paused') {
      this.log.info({ turnId: turn.id, steps: result.steps }, 'turn paused');
      // 暂停也关闭本次输出流，发终态 finish part（恢复执行走新的 run/流）
      context.controller.enqueue(finishPart('stop', usage));
      return {
        status: 'paused',
        steps: result.steps,
        usage,
        messages: context.messages,
        thread,
        turn,
      };
    }

    // 模型错误导致的失败
    if (result.status === 'failed') {
      const err = result.error!;
      // 失败态也落库本 turn 累计用量，供审计与 thread 累加
      await this.thread.updateTurn(turn.id, {
        status: 'failed',
        steps: result.steps,
        metadata: { ...turn.metadata, usage },
      });
      await this.saveCheckpoint(context, 'failed')

      context.controller.enqueue(finishPart('error', usage));
      this.emit({ type: 'error', error: err });

      return {
        status: 'failed',
        steps: result.steps,
        usage,
        messages: context.messages,
        thread,
        turn,
        error: result.error,
      };
    }

    // 更新turn的完结态，并把本 turn 累计用量写入 turn.metadata.usage
    await this.thread.updateTurn(turn.id, {
      status: result.status,
      steps: result.steps,
      metadata: { ...turn.metadata, usage },
    });

    // turn 完结后累加 thread 总用量（含分叉产生的调用，实际消费口径）
    const threadUsage = addUsage(thread.metadata?.usage ?? emptyUsage(), usage);
    await this.thread.updateThread(thread.id, { metadata: { ...thread.metadata, usage: threadUsage } });

    // 终态进版本链（nextAction='end'），审计可见；版本链全量保留
    await this.saveCheckpoint(context, 'end')

    // 终态生命周期 part：中断先发 abort，再统一发 finish
    if (result.status === 'aborted') {
      context.controller.enqueue({ type: 'abort' });
    }
    context.controller.enqueue(finishPart(result.status === 'aborted' ? 'other' : 'stop', usage));
    this.emit({ type: 'done', usage });

    return {
      status: result.status,
      steps: result.steps,
      usage,
      messages: context.messages,
      thread,
      turn,
    };
  }

  /**
   * 执行 step loop，由 startTurn 的洋葱核心调用（新 turn 与恢复共用）。
   */
  private async runLoop(context: TurnContext<TToolSet>): Promise<StepLoopResult> {
    let usage = emptyUsage();

    const {session: {turn}, signal, checkpoint} = context

    // 加载最近的 CR，未完结的尝试恢复
    await this.loadCheckpoint(context)

    let steps = checkpoint.stepIndex;

    while (steps < this.maxSteps && !signal.aborted) {
      const step: TurnStep = { index: steps, messages: context.messages };

      this.emit({ type: 'step-start', step: step.index });

      const { action, pendingApprovalCalls, approvedCalls, deniedResults, usage: stepUsage, error } = await this.executeModelStep(step, context);
      usage = addUsage(usage, stepUsage);

      if (action === 'pause') {
        // 暂停现场进版本树（nextAction='tool-approval'）
        await this.saveCheckpoint(context, 'tool-approval', {
          pendingApprovalCalls: pendingApprovalCalls ?? [],
          approvedCalls: approvedCalls ?? [],
          deniedResults: deniedResults ?? [],
        })
        // 暂停前写 usage 快照：历史累计（context.usage）+ 本次 loop 累计，恢复时据此续算
        await this.thread.updateTurn(turn.id, {
          status: 'paused',
          steps,
          metadata: { ...turn.metadata, usage: addUsage(context.usage, usage) },
        });
        return { status: 'paused', steps, usage };
      }

      if (action === 'break') {
        // 如果是因为模型错误 直接短路
        if (error) {
          return { status: 'failed', steps, usage, error };
        }
        break
      }

      // 接下来处理多轮循环， action === 'continue'
      // 执行本轮 auto 批准的调用，拒绝结果一并落消息链（结果只落消息链，checkpoint 已留执行清单）
      await this.executeToolCalls(context, approvedCalls ?? [], deniedResults ?? []);

      this.emit({ type: 'step-end', step: step.index });
      // step 完成 → 推进版本：清单清空，标志本轮决策执行完毕
      steps++;
    }
    return { status: signal.aborted ? 'aborted' : 'completed', steps, usage };
  }

  /**
   * 保存checkpoint
   * @param context
   * @param nextAction
   * @param partial
   * @private
   */
  private async saveCheckpoint(context: TurnContext<TToolSet>, nextAction: NextAction, partial?: CheckpointApprovalCalls): Promise<Checkpoint> {

    const {checkpoint} = context

    // 模型调用，stepIndex + 1
    const stepIndex = nextAction === 'model' ? checkpoint.stepIndex + 1 : checkpoint.stepIndex;

    // tool call 已经调用完结，不需要继承
    const withoutToolCall = nextAction === 'model' || nextAction === 'end' || nextAction === 'failed';

    const pendingApprovalCalls = withoutToolCall ? [] : (partial?.pendingApprovalCalls ?? checkpoint.pendingApprovalCalls);
    const approvedCalls = withoutToolCall ? [] : (partial?.approvedCalls ?? checkpoint.approvedCalls);
    const deniedResults = withoutToolCall ? [] : (partial?.deniedResults ?? checkpoint.deniedResults);

    return context.checkpoint = await this.checkpointStore.append(context.checkpoint, {
      parentId: checkpoint.id,
      stepIndex: stepIndex,
      nextAction: nextAction,
      decisions: Array.from(context.decisions.values()),
      approvedTools: Array.from(context.approvedTools.values()),
      pendingApprovalCalls: pendingApprovalCalls,
      approvedCalls: approvedCalls,
      deniedResults: deniedResults,
      lastMessageId: checkpoint.lastMessageId,
    });
  }

  /**
   * 从 checkpoint 中还原现场
   * @param context
   * @private
   */
  private async loadCheckpoint(context: TurnContext<TToolSet>){
    const {checkpoint} = context

    // 已完结的忽略
    if (checkpoint.nextAction === 'end') {
      return
    }

    // 还原到上下文
    checkpoint.decisions.forEach(decision => {context.decisions.set(decision.toolCallId, decision)})
    checkpoint.approvedTools.forEach(tool => {context.approvedTools.set(tool.toolName, tool)})

    // 已完成的 tool call ids
    const completedToolCallIds = completedCallIds(context.messages)

    const approvedCalls: ToolCall[] = [];
    const deniedResults: ToolResult[] = [];
    // session 级审批工具名（循环内收集，循环结束后批量持久化）
    const sessionScopedTools = new Set<string>();

    // 待审批的call
    for (const pendingCall of checkpoint.pendingApprovalCalls) {
      const decision = context.decisions.get(pendingCall.id)
      const approvedTool = context.approvedTools.get(pendingCall.name);

      if (!decision && !approvedTool) {
        continue
      }

      // 有显式决策时以决策为准；否则说明工具已被自动放行（approvedTools 恒为 approved: true）
      const approved = decision?.approved ?? approvedTool?.approved ?? false;
      const scope = decision?.scope ?? 'turn';
      const reason = decision?.reason;
      // 回放审批决策到输出流（恢复后的新流可见完整审批链路），reason 携带用户文本回答
      context.controller.enqueue(toolApprovalResponsePart(pendingCall, approved, { scope, reason }));
      if (approved) {
        // 批准后正常执行 execute（澄清类工具从 ctx.approval 读取用户回答）
        approvedCalls.push(pendingCall);
        // 追踪到 approvedTools，确保同一 turn 后续 step 中该工具自动放行
        context.approvedTools.set(pendingCall.name, {
          toolName: pendingCall.name,
          approved: true,
          approvedAt: Date.now(),
        });
        // session 级审批：收集工具名，循环结束后批量持久化到 thread.metadata
        if (scope === 'session') {
          sessionScopedTools.add(pendingCall.name);
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
    // session 级审批批量落库：一次 updateThread，避免逐个写入
    await this.saveSessionApprovals(context, sessionScopedTools);

    // 本轮次要执行的 tool calls
    const allApprovedCalls = [...checkpoint.approvedCalls, ...approvedCalls].filter(call => !completedToolCallIds.has(call.id))
    const allDeniedResults = [...checkpoint.deniedResults, ...deniedResults].filter(result => !completedToolCallIds.has(result.callId))

    await this.executeToolCalls(context, allApprovedCalls, allDeniedResults);
  }

  /**
   * 执行工具调用
   * @param context
   * @param approvedCalls
   * @param deniedResults
   * @private
   */
  private async executeToolCalls(context: TurnContext<TToolSet>, approvedCalls: ToolCall[], deniedResults: ToolResult[]){
    // 预先保存checkpoint
    if (approvedCalls.length  === 0 && deniedResults.length === 0) {
      return
    }

    await this.saveCheckpoint(context, 'tool-execution', {
      pendingApprovalCalls: [],
      approvedCalls: approvedCalls,
      deniedResults: deniedResults,
    })

    // 执行本轮批准的调用；拒绝结果一并落消息链
    const toolResults = await this.toolExecutor.executeToolCalls(approvedCalls, context, (call, result) => {
      context.controller.enqueue(toolResultPart(result, call.args));
      this.emit({ type: 'tool-result', id: result.callId, name: result.name, status: result.status, output: result.output });
    });
    await this.appendToolResults([...toolResults, ...deniedResults], context);

    await this.saveCheckpoint(context, 'model')
  }


  /**
   * 执行一个 model step 的模型侧流程：压缩 → model 调用 → 审批分类。
   *
   * 职责边界：本方法只负责「生成 + 分类」，不直接执行工具。工具执行与结果持久化
   * 由 runLoop 在 append「计划版本」后进行（每 step 双写：计划 + 推进），以便工具
   * 执行中途中断/崩溃时可按「checkpoint 清单 − 消息链已完成」差集恢复补跑。
   *
   * @param step 当前步骤对象（携带 index 与消息链）
   * @param context 本 turn 的共享上下文（消息、审批状态、中断信号、流控制器、checkpoint）
   * @returns 步骤结果，action 三态：
   *   - `break`：token 耗尽 / 模型出错 / 已中止 / 无工具调用，终止循环
   *   - `pause`：存在待审批工具，暂停 turn 等待客户端审批（附 pendingApprovalCalls）
   *   - `continue`：工具已审批通过，交由 runLoop 落「计划版本」后执行
   */
  private async executeModelStep(step: TurnStep, context: TurnContext<TToolSet>): Promise<ModelStepResult> {

    let usage = emptyUsage();

    const modelResult = await this.callModel(step, context);

    // 如果模型调用出错，提前结束
    if (modelResult.error) {
      return { action: 'break', usage, error: modelResult.error };
    }

    // 模型返回后检查中断信号，避免在已取消的 turn 中继续执行工具
    if (context.signal.aborted) {
      return { action: 'break', usage };
    }

    usage = addUsage(usage, modelResult.usage);

    // 审批 + 执行 + 持久化
    const { approvedCalls, deniedResults, pendingApprovalCalls } = await this.resolveToolApprovals(modelResult.toolCalls, context);

    // 模型输出后的消息处理（text + tool-call parts 组装为原生 assistant 消息）
    if (modelResult.text || modelResult.toolCalls.length > 0) {
      const assistantMsg = buildAssistantMessage(modelResult.text, modelResult.toolCalls, modelResult.reasoning, pendingApprovalCalls);
      context.messages.push(assistantMsg);

      // usage 与 assistant 消息一一对应：仅在持久化副本上挂载，消息链保持纯净（不随上下文发给模型）
      await this.persistMessages(context, [{ ...assistantMsg, usage: modelResult.usage }]);
    }

    if (modelResult.toolCalls.length === 0) {
      return { action: 'break', usage };
    }

    // 有待审批的工具 → 暂停 turn
    // 因为未决的 tool_use 不能出现在发给模型的后续请求中
    if (pendingApprovalCalls.length > 0) {
      return { action: 'pause', pendingApprovalCalls, approvedCalls, deniedResults, usage };
    }

    // 已批准的调用不再在此执行——审批分类结果返回 runLoop：先落「计划版本」清单再执行，
    // 使工具执行中途中断/崩溃时可按「checkpoint 清单 − 消息链已完成」差集恢复补跑。
    return { action: 'continue', approvedCalls, deniedResults, usage };
  }

  /**
   * 解析工具审批：遍历 toolCalls，按策略分类为 approvedCalls / deniedResults / pendingApprovalCalls。
   */
  private async resolveToolApprovals(toolCalls: ToolCall[], context: TurnContext<TToolSet>): Promise<ResolvedApprovals> {
    const approvedCalls: ToolCall[] = [];
    const deniedResults: ToolResult[] = [];
    const pendingApprovalCalls: ToolCall[] = [];

    for (const call of toolCalls) {
      const tool = this.toolExecutor.findTool(call.name);
      const policy = tool?.policy ?? 'auto';

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

      // session 级放行：本 thread 内已「始终允许」的工具跳过 resolver 直接批准
      // （loadSessionApprovals 在 turn 起始已把 thread.metadata.approvedTools 预填进来）
      if (context.approvedTools.get(call.name)?.approved === true) {
        approvedCalls.push(call);
        continue;
      }

      const decision = await this.approvalResolver(call, tool, policy, {
        toolArgs: call.args,
        workspace: context.session.workspace,
        approvalMode: context.approvalMode,
      });

      switch (decision.status) {
        case 'approved': {
          context.approvedTools.set(call.name, {
            toolName: call.name,
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
            error: decision.reason ?? 'Blocked by policy',
          });
          context.controller.enqueue(toolOutputDeniedPart(call));
          break;
        }
      }
    }

    return { approvedCalls, deniedResults, pendingApprovalCalls };
  }

  /**
   * 批量持久化 session 级工具审批到 thread.metadata。
   */
  private async saveSessionApprovals(context: TurnContext<TToolSet>, toolNames: Set<string>): Promise<void> {
    if (toolNames.size === 0) return;

    const meta = context.session.thread.metadata ?? {};
    meta.approvedTools ??= {};
    const now = Date.now();
    for (const toolName of toolNames) {
      meta.approvedTools[toolName] = { approvedAt: now };
    }

    await this.thread.updateThread(context.session.thread.id, { metadata: meta });
  }

  /**
   * 从 thread.metadata 加载 session 级审批，预填入 approvedTools Map。
   */
  private loadSessionApprovals(session: TurnSession, context: TurnContext<TToolSet>): void {
    const sessionApproved = session.thread.metadata?.approvedTools;
    if (!sessionApproved) return;
    for (const [name, entry] of Object.entries(sessionApproved)) {
      context.approvedTools.set(name, {
        toolName: name,
        approved: true,
        approvedAt: entry.approvedAt });
    }
  }

  /**
   * 批量持久化消息到 threadStore。
   */
  async persistMessages(context: TurnContext<TToolSet>, messages: MessageWithUsage[]): Promise<void> {
    if (messages.length === 0) {
      return
    }

    const threadId = context.session.thread.id;
    const turnId = context.session.turn.id;

    // usage 与消息一一对应：fromModelMessage 从每条消息取出 usage 写入 metadata
    const converted = messages.map(message => ({ threadId, turnId, ...fromModelMessage(message) }))
    const created = await this.thread.appendEntries(converted);

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

  /** 发射压缩事件 */
  private emitCompacted(result: CompactionResult): void {
    this.emit({
      type: 'compacted',
      summaryMessageId: result.summaryMessageId,
      archivedTurnIds: result.archivedTurnIds,
      removedTokens: result.removedTokens,
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

  /**
   * 单次模型调用（含 context-overflow 压缩恢复）。messages 已由调用方预处理（含 ctx.before/after）。
   */
  private async callModel(step: TurnStep, context: TurnContext<TToolSet>): Promise<CallModelResult> {
    const { ctx, controller } = context;

    const resolveError = (error: Error | string): CallModelResult => {
      this.emit({ type: 'error', error });
      try {
        controller.enqueue({ type: 'error', error });
      } catch (e) {
        this.log.warn({ threadId: context.session.thread.id, err: e }, 'controller closed, error enqueue ignored');
      }
      return { text: '', reasoning: '', toolCalls: [], usage: emptyUsage(), error };
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
        const result = await context.modelClient.stream(request);
        const stream = result.stream.pipeThrough(createModelStreamTransformer<TToolSet>(request));
        await forwardToController(stream, controller);
        return result.result();
      } catch (e) {
        return resolveError(e instanceof Error ? e : new Error(String(e)));
      }
    };

    const first = await attempt();

    // usage 锚定：无论成功失败，记录 provider 上报的 prompt token（无上报时传 undefined 清除锚点）
    this.compactor?.recordUsage(context.session.thread.id, first.usage.inputTokens?.total);

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
}
