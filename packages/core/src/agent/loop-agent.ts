// @vico/core - LoopAgent: Agent 默认实现，驱动单个 turn 的 model→tool→repeat 循环
import type {Logger} from 'pino';
import pino from 'pino';
import type {LanguageModelV4, LanguageModelV4StreamPart} from '@ai-sdk/provider';
import type {ModelMessage, TextStreamPart, ToolSet} from 'ai';

import type {Agent, AgentOptions} from './agent.js';
import type {ToolMetadata, TurnEvent, UsageMetrics} from './types.js';
import type {ApprovalResolver, Tool, ToolCall, ToolResult} from '../tool/types.js';
import type {Skill} from '../skill/types.js';
import type {MemoryStore} from '../memory/memory-store.js';
import type {ThreadStore} from '../thread/thread-store.js';
import type {EventPayload, EventRecorder, EventType} from '../events/types.js';
import type {UserMessage} from '../stream/types.js';
import type {ModelRequest, ReasoningEffort} from '../model/types.js';
import type {ContextCompactor} from './context-compactor.js';
import type {TokenEconomy} from './token-economy.js';
import type {Checkpoint, CheckpointStore, PauseInfo} from './checkpoint.js';
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
import {resolvePolicy} from '../tool/utils.js';
import {fromModelMessage, normalizeUserMessage, toModelMessages} from './utils.js';
import {TurnOutput} from './turn-output.js';
import {
  createToolCall,
  finishPart,
  finishStepPart,
  startStepPart,
  toolApprovalRequestPart,
  toolApprovalResponsePart,
  toolOutputDeniedPart,
  v4FilePart,
  v4ToolResultPart,
} from './stream-parts.js';
import {
  buildAssistantMessage,
  buildToolResultMessage,
  extractApprovalResponses,
  getMessageText,
  getToolResultText,
  hasToolResult,
  pickPrimaryUserMessage,
} from '../model/message-utils.js';
import type {ToolExecutorHost} from './tool-executor.js';
import {ToolExecutor} from './tool-executor.js';
import {ModelRequestContext} from './context-processors/model-request-context.js';
import {SystemPromptProcessor} from './context-processors/system-prompt-processor.js';
import {SkillProcessor} from './context-processors/skill-processor.js';
import {MemoryProcessor} from './context-processors/memory-processor.js';
import {WorkspaceToolProcessor} from './context-processors/workspace-tool-processor.js';

/** LoopAgent 构造选项 */
export interface LoopAgentOptions<TToolSet extends ToolSet = ToolSet> extends AgentOptions {
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
export class LoopAgent<TToolSet extends ToolSet = ToolSet, TMetadata extends ToolMetadata = ToolMetadata>
  implements Agent<TToolSet, TMetadata>, ToolExecutorHost<TToolSet> {

  readonly id: string;
  readonly name: string;
  readonly systemPrompt: string;
  readonly model: LanguageModelV4;
  readonly modelClient: ModelClient;
  readonly temperature: number;
  readonly reasoning?: ReasoningEffort;
  readonly maxTokens: number;
  readonly maxSteps: number;
  readonly skills: Skill[];
  readonly tools: Tool[];
  readonly memory: MemoryStore;
  readonly thread: ThreadStore;
  readonly approvalResolver: ApprovalResolver;
  readonly events: EventRecorder<TurnEvent>;
  readonly workspace?: string;
  readonly compactor?: ContextCompactor;
  readonly tokenEconomy?: TokenEconomy;
  readonly checkpointStore: CheckpointStore;
  readonly logger: Logger;

  private readonly toolExecutor: ToolExecutor<TToolSet>;
  private readonly pipeline: ProcessorPipeline;

  constructor(options: LoopAgentOptions<TToolSet>) {
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
    this.approvalResolver = rest.approvalResolver ?? resolvePolicy;
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
   * 发起一次对话：发送消息并等待返回最终结果（非流式）。
   *
   * @param message - 用户消息
   * @param options - 调用可选参数
   * @returns turn 最终结果
   */
  async invoke(message: UserMessage, options?: RunOptions<TMetadata>): Promise<TurnResult> {
    const output = await this.run(await normalizeUserMessage(message), options);
    return output.result;
  }

  /**
   * 流式对话 — 返回 TurnOutput，含 ReadableStream 流和 result Promise。
   *
   * @param message - 用户消息
   * @param options - turn 运行可选参数
   */
  async stream(message: UserMessage, options?: RunOptions<TMetadata>): Promise<TurnOutput> {
    return this.run(await normalizeUserMessage(message), options);
  }

  /**
   * 执行一个 turn，同步返回 TurnOutput（含 ReadableStream 流和 result Promise）。
   * 历史消息由 Memory 自动补充。外部通过 TurnOutput.abort() 终止。
   *
   * @param userMessages - 本轮输入消息组
   * @param options - turn 运行可选参数
   * @returns TurnOutput 实例，包含输出流和结果 Promise
   */
  private run(userMessages: ModelMessage[], options?: RunOptions): TurnOutput {
    const { promise, resolve } = Promise.withResolvers<TurnResult>();

    const internalAc = new AbortController();

    const abort = () => {
      internalAc.abort();
    };

    const stream = new ReadableStream<TextStreamPart<TToolSet>>({
      start: async (controller) => {
        controller.enqueue({ type: 'start' });
        try {
          const result = await this.start({userMessages, signal: internalAc.signal, controller, options});
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
    options?: RunOptions;
  }): Promise<TurnResult> {
    const { userMessages, signal, controller, options } = ctx;
    const threadId = options?.threadId ?? `${this.id}-${Date.now()}`;

    let thread = await this.thread.getThread(threadId);
    if (!thread) {
      // 标题取主用户消息（末条 user 角色）文本
      const primary = pickPrimaryUserMessage(userMessages);
      const title = (primary ? getMessageText(primary) : '').slice(0, 50);
      const workspace = options?.workspace ?? this.workspace;
      const metadata = { ...options?.metadata, workspace };
      thread = await this.thread.createThread(this.id, title, threadId, { ...options, metadata });
      this.log.debug({ threadId, agentId: this.id }, 'thread created');
    }

    const workspace = options?.workspace ?? thread.metadata?.workspace ?? this.workspace;

    // 自动恢复所有未完成的 turn（paused/running/failed），前提是存在 checkpoint
    const latestTurn = await this.thread.getLatestTurn(threadId);
    if (latestTurn && latestTurn.status !== 'completed') {
      const checkpoint = await this.checkpointStore.getByTurn(latestTurn.id);
      if (checkpoint) {
        this.log.info({ turnId: latestTurn.id, threadId, status: latestTurn.status }, 'resuming turn');
        const session: TurnSession = { workspace, thread, turn: latestTurn };
        return this.resumeTurn({ session, checkpoint, userMessages, signal, controller });
      }
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

    // 本轮次的上下文对象
    const context: TurnContext<TToolSet> = { ctx: requestContext, messages: [...requestContext.messages], session, approvedTools, signal, controller };

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
    const { thread, turn } = session;

    const usage: UsageMetrics = { input: 0, output: 0 };

    // 从本轮消息组解析审批决策（in-band 协议）：审批消息由引擎消费，剔除后其余消息进消息链
    const { decisions } = extractApprovalResponses(userMessages);


    // 恢复历史消息
    const entries = await this.thread.getEntriesByTurns([turn.id]);
    const messages = toModelMessages(entries);

    // 构建request context, 补全必要信息
    const requestContext = new ModelRequestContext({agent: this, messages, tools: this.tools, session});
    await this.pipeline.enter(requestContext);

    // ——— checkpoint 恢复逻辑 ———
    const approvedTools = new Map<string, ToolApproval>(Object.entries(checkpoint.approvedTools));
    this.loadSessionApprovals(session, approvedTools);
    const context: TurnContext<TToolSet> = { ctx: requestContext, messages: [...requestContext.messages], session, approvedTools, signal, controller };

    // 还原已完成工具结果到消息链
    const newToolMessages = this.restoreCompletedToolResults(checkpoint.completedToolResults);
    if (newToolMessages.length > 0) {
      await this.persistMessages(context, newToolMessages);
    }
    context.messages.push(...newToolMessages);

    if (checkpoint.pauseInfo) {
      // 路径 A：审批恢复
      this.log.debug({ turnId: turn.id }, 'resume path A: approval recovery');
      await this.applyPauseInfoRecovery(checkpoint.pauseInfo, decisions, context);
      // 清除 pauseInfo
      await this.checkpointStore.save(turn.id, thread.id, { pauseInfo: null });
    } else if (checkpoint.pendingToolCall) {
      // 路径 B：工具重试
      this.log.debug({ turnId: turn.id, toolName: checkpoint.pendingToolCall.name }, 'resume path B: tool retry');
      await this.resolvePendingTool(checkpoint.pendingToolCall, checkpoint, messages, context);
    } else {
      // 路径 C：pendingToolCall == null → 直接继续
      this.log.debug({ turnId: turn.id }, 'resume path C: direct continue');
    }

    await this.thread.updateTurn(turn.id, { status: 'running' });
    return this.startTurnLoop(checkpoint.stepIndex, context, usage);
  }

  /**
   * 从 pauseInfo 恢复工具调用：执行自动批准的调用、追加自动拒绝的结果、
   * 处理等待审批的调用（根据 approvalDecisions 决定执行或拒绝）。
   */
  private async applyPauseInfoRecovery(pauseInfo: PauseInfo, decisions: ToolCallApproval[], context: TurnContext<TToolSet>): Promise<void> {
    if (pauseInfo.reason !== 'tool-approval') return;

    const decisionMap = new Map(decisions.map(d => [d.toolCallId, d]));

    // 1. 执行暂停前已自动批准的调用（executeToolCalls 内部逐条持久化）
    if (pauseInfo.approvedCalls && pauseInfo.approvedCalls.length > 0) {
      await this.toolExecutor.executeToolCalls(pauseInfo.approvedCalls, context);
    }

    // 2. 持久化暂停前已自动拒绝的结果
    if (pauseInfo.deniedResults && pauseInfo.deniedResults.length > 0) {
      await this.appendToolResults(pauseInfo.deniedResults, context);
    }

    // 3. 处理等待审批的调用
    const approvedCalls: ToolCall[] = [];
    const deniedResults: ToolResult[] = [];

    for (const pendingCall of pauseInfo.pendingToolCalls) {
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

    // 3a. 执行用户批准的调用（内部逐条持久化）
    if (approvedCalls.length > 0) {
      await this.toolExecutor.executeToolCalls(approvedCalls, context);
    }
    // 3b. 持久化用户拒绝的结果
    if (deniedResults.length > 0) {
      await this.appendToolResults(deniedResults, context);
    }
  }

  /**
   * 路径 B：重试 pending 工具。
   * 执行前检查消息链，若已有 tool_result 则跳过（并发恢复保护）。
   */
  private async resolvePendingTool(
    pending: ToolCall,
    checkpoint: Checkpoint,
    messages: ModelMessage[],
    context: TurnContext<TToolSet>,
  ): Promise<void> {
    const turnId = context.session.turn.id;
    const threadId = context.session.thread.id;

    // 检查消息链中是否已有此 toolCall 的 tool_result（并发保护）
    if (hasToolResult(messages, pending.id)) {
      // 跳过执行，从消息链提取已有结果并更新 checkpoint
      const existingResult: ToolResult = {
        callId: pending.id,
        name: pending.name,
        status: 'success',
        output: getToolResultText(messages, pending.id) ?? null,
      };
      await this.checkpointStore.save(turnId, threadId, {
        completedToolResults: [...checkpoint.completedToolResults, existingResult],
        pendingToolCall: null,
      });
      return;
    }

    // 执行工具并持久化（pending 中已存完整 args，直接构造 ToolCall 即可）
    await this.toolExecutor.executeToolCalls([{ id: pending.id, name: pending.name, args: pending.args }], context);
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
      this.log.error({ turnId: turn.id, error: err instanceof Error ? err.message : String(err) }, 'turn failed');
      await this.thread.updateTurn(turn.id, { status: 'failed', steps: loopResult.steps });
      this.emit({ type: 'error', error: err });
      context.controller.enqueue(finishPart('error', usage));

      const failResult: TurnResult = {
        status: 'failed', steps: loopResult.steps, usage, messages: context.messages,
        thread, turn, error: loopResult.error,
      };
      return failResult;
    }

    const status = loopResult.status === 'aborted' ? 'aborted' : 'completed';
    await this.thread.updateTurn(turn.id, { status, steps: loopResult.steps });

    // completed 终态：清理 checkpoint
    if (status === 'completed') {
      this.log.info({ turnId: turn.id, steps: loopResult.steps }, 'turn completed, cleaning checkpoint');
      await this.checkpointStore.deleteByTurn(turn.id);
    }

    // 终态生命周期 part：中断先发 abort，再统一发 finish
    if (status === 'aborted') {
      context.controller.enqueue({ type: 'abort' });
    }
    context.controller.enqueue(finishPart(status === 'aborted' ? 'other' : 'stop', usage));
    this.emit({ type: 'done', usage });

    const finalResult: TurnResult = {
      status: loopResult.status === 'aborted'
        ? (context.signal.aborted ? 'interrupted' : 'aborted')
        : 'completed',
      steps: loopResult.steps,
      usage,
      messages: context.messages,
      thread,
      turn,
    };
    return finalResult;
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
      const { action, pauseInfo, usage: stepUsage, error } = await this.executeModelStep(step, context);
      usage.input += stepUsage.input;
      usage.output += stepUsage.output;

      if (action === 'pause') {
        // 持久化暂停信息到 checkpoint（替代 turn.metadata）
        await this.checkpointStore.save(turn.id, context.session.thread.id, {
          pauseInfo,
          approvedTools: Object.fromEntries(context.approvedTools),
          stepIndex: steps,
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
      steps++;
    }

    return { status: signal.aborted ? 'aborted' : 'completed', steps, usage };
  }

  /**
   * 执行一个 model step：压缩 → model 调用 → 审批 → 工具执行 → 持久化。
   */
  private async executeModelStep(step: Step, context: TurnContext<TToolSet>): Promise<ModelStepResult> {
    this.emit({ type: 'step-start', step: step.index + 1 });
    this.log.debug({ turnId: context.session.turn.id, step: step.index, messageCount: context.messages.length }, 'step start');

    // step-start checkpoint：记录当前 step 进度
    await this.checkpointStore.save(context.session.turn.id, context.session.thread.id, {
      stepIndex: step.index,
      pendingToolCall: null,
      approvedTools: Object.fromEntries(context.approvedTools),
    });

    const usage = { input: 0, output: 0 };

    await this.tryCompact(step, context.signal);

    if (this.tokenEconomy?.isInputExhausted()) {
      this.log.warn({ turnId: context.session.turn.id, step: step.index }, 'input token budget exhausted');
      this.emit({ type: 'error', error: '输入 token 预算已耗尽' });
      return { action: 'break', usage };
    }

    if (this.tokenEconomy?.isOutputExhausted()) {
      this.log.warn({ turnId: context.session.turn.id, step: step.index }, 'output token budget exhausted');
      this.emit({ type: 'error', error: '输出 token 预算已耗尽' });
      return { action: 'break', usage };
    }

    const modelResult = await this.callModel(step, context);

    // 如果模型调用出错，提前结束
    if (modelResult.error) {
      this.log.error({ turnId: context.session.turn.id, step: step.index, error: modelResult.error instanceof Error ? modelResult.error.message : String(modelResult.error) }, 'model call failed');
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
    const { approvedCalls, deniedResults, pausedCalls } = await this.resolveToolApprovals(modelResult.toolCalls, context);

    // 有待审批的工具 → 暂停 turn
    // 因为未决的 tool_use 不能出现在发给模型的后续请求中
    if (pausedCalls.length > 0) {

      const pauseInfo: PauseInfo = {
        reason: 'tool-approval',
        pendingToolCalls: pausedCalls,
        // 保存已在审批阶段自动决策的调用，恢复时直接使用，避免重复审批
        approvedCalls: approvedCalls,
        deniedResults: deniedResults,
        pausedAtStep: step.index,
      };
      this.emit({ type: 'step-end', step: step.index + 1 });
      return { action: 'pause', pauseInfo, usage };
    }

    // 已批准的调用直接执行（executeToolCalls 内部逐条持久化，无需再次 appendToolResults）
    await this.toolExecutor.executeToolCalls(approvedCalls, context);
    // 拒绝结果单独持久化
    if (deniedResults.length > 0) {
      await this.appendToolResults(deniedResults, context);
    }

    this.emit({ type: 'step-end', step: step.index + 1 });
    return { action: 'continue', usage };
  }

  /**
   * 解析工具审批：遍历 toolCalls，按策略分类为 approvedCalls / deniedResults / pausedCalls。
   */
  private async resolveToolApprovals(toolCalls: ToolCall[], context: TurnContext<TToolSet>): Promise<ApprovalClassification> {
    const approvedCalls: ToolCall[] = [];
    const deniedResults: ToolResult[] = [];
    const pausedCalls: ToolCall[] = [];

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
          pausedCalls.push(call);
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

    return { approvedCalls, deniedResults, pausedCalls };
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
    const threadId = context.session.thread.id;
    const turnId = context.session.turn.id;
    await this.thread.appendEntries(
      messages.map(message => ({ threadId, turnId, ...fromModelMessage(message) })),
    );
  }

  /**
   * 将 checkpoint 中已完成的工具结果还原为原生 tool 消息列表。
   */
  private restoreCompletedToolResults(results: ToolResult[]): ModelMessage[] {
    return results.map(result => {
      const content = this.resolveToolResult(result);
      return buildToolResultMessage(result, content);
    });
  }

  /**
   * 发射事件到订阅者（箭头函数绑定 this，可直接作为回调传递）。
   */
  emit = (event: TurnEvent): void => {
    this.events.emit(event);
  };

  /** 将 ToolResult 转为消息文本，可选 token 截断 */
  resolveToolResult(r: ToolResult): string {
    const raw = r.status === 'success'
      ? (typeof r.output === 'string' ? r.output : JSON.stringify(r.output))
      : (r.error instanceof Error ? r.error.message : (r.error ?? 'tool execution failed'));
    return this.tokenEconomy?.truncateToolOutput(raw) ?? raw;
  }

  /** 工具结果 → 原生 tool 消息 + 批量持久化 */
  async appendToolResults(toolResults: ToolResult[], context: TurnContext<TToolSet>): Promise<void> {
    const messages: ModelMessage[] = [];
    for (const r of toolResults) {
      const content = this.resolveToolResult(r);
      const message = buildToolResultMessage(r, content);
      context.messages.push(message);
      messages.push(message);
    }
    if (messages.length > 0) {
      await this.persistMessages(context, messages);
    }
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
    const modelUsage = { input: 0, output: 0 };

    const request: ModelRequest = {
      system: ctx.systemPrompt,
      messages: step.messages,
      tools: ctx.tools,
      maxOutputTokens: this.maxTokens,
      temperature: this.temperature,
      reasoning: this.reasoning,
    };

    let fullText = '';
    let fullReasoning = '';
    const toolCalls: ToolCall[] = [];

    // ── V4 → TextStreamPart 转换所需的 step 级状态 ──
    const stepStartTime = Date.now();
    /** 首个输出 chunk 到达时间（性能指标 timeToFirstOutputMs） */
    let firstChunkTime: number | undefined;
    /** start-step 是否已发出（stream-start 携带 warnings；未收到时由首个内容 part 兜底触发） */
    let stepStarted = false;
    /** controller 是否已关闭（客户端断开）→ 终止当前 step 的流式输出 */
    let controllerClosed = false;
    /** 从 V4 response-metadata 捕获，进 finish-step.response */
    let responseMeta: { id?: string; modelId?: string; timestamp?: Date } = {};
    /** toolCallId → ToolCall，供 provider 端 tool-result / tool-approval-request 关联 input */
    const callsById = new Map<string, ToolCall>();

    const ensureStepStarted = (warnings: Parameters<typeof startStepPart>[1] = []) => {
      if (stepStarted || controllerClosed) return;
      stepStarted = true;
      try {
        controller.enqueue(startStepPart(step.messages, warnings));
      } catch {
        controllerClosed = true;
      }
    };

    let stream: ReadableStream<LanguageModelV4StreamPart>;
    try {
      ({ stream } = await this.modelClient.stream(request, context.signal));
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      this.log.error({ err }, 'modelClient.stream 调用失败');
      controller.enqueue({ type: 'error', error: err.message });
      return this.recordModelError(err, { text: '', toolCalls: [], usage: { input: 0, output: 0 } });
    }

    for await (const chunk of stream) {
      // stream-start 携带 warnings → start-step；其余 part 到达前兜底补发 start-step
      if (chunk.type === 'stream-start') {
        ensureStepStarted(chunk.warnings);
        if (controllerClosed) break;
        continue;
      }
      ensureStepStarted();
      if (controllerClosed) break;

      switch (chunk.type) {
          // ── 同形透传（重建对象以对齐引擎层类型）──
          case 'text-start':
          case 'text-end':
          case 'reasoning-start':
          case 'reasoning-end':
            controller.enqueue(chunk);
            break;

          // ── 文本/推理 delta：V4 的 delta 字段 → TextStreamPart 的 text 字段 ──
          case 'text-delta':
            firstChunkTime ??= Date.now();
            controller.enqueue({ type: 'text-delta', id: chunk.id, text: chunk.delta, providerMetadata: chunk.providerMetadata });
            fullText += chunk.delta;
            this.emit({ type: 'text-delta', content: chunk.delta });
            break;

          case 'reasoning-delta':
            firstChunkTime ??= Date.now();
            fullReasoning += chunk.delta;
            controller.enqueue({ type: 'reasoning-delta', id: chunk.id, text: chunk.delta, providerMetadata: chunk.providerMetadata });
            this.emit({ type: 'reasoning-delta', content: chunk.delta });
            break;

          // ── 工具输入流式（同形透传）──
          case 'tool-input-start':
          case 'tool-input-delta':
          case 'tool-input-end':
            controller.enqueue(chunk);
            break;

          case 'tool-call': {
            // V4 tool-call 的 input 为 JSON 字符串，解析失败时兜底空对象并以 invalid 标记
            let args: Record<string, unknown>;
            let invalid = false;
            let parseError: unknown;
            try {
              args = chunk.input ? JSON.parse(chunk.input) as Record<string, unknown> : {};
            } catch (e) {
              this.log.warn({ toolCallId: chunk.toolCallId, input: chunk.input }, 'tool-call input JSON 解析失败');
              args = {};
              invalid = true;
              parseError = e;
            }
            const call: ToolCall = { id: chunk.toolCallId, name: chunk.toolName, args };
            callsById.set(call.id, call);
            controller.enqueue(createToolCall(call, { providerExecuted: chunk.providerExecuted, invalid, error: parseError }));
            // provider 已执行的调用不进本地执行队列（结果随流到达）
            if (!chunk.providerExecuted) {
              toolCalls.push(call);
            }
            this.emit({ type: 'tool-call-start', id: chunk.toolCallId, name: chunk.toolName, args });
            break;
          }

          // ── provider 端执行的工具结果：isError 分流 tool-result / tool-error ──
          case 'tool-result':
            controller.enqueue(v4ToolResultPart(chunk, callsById.get(chunk.toolCallId)?.args));
            break;

          // ── provider 端审批请求：关联已记录的 toolCall（查不到则合成占位调用）──
          case 'tool-approval-request': {
            const call = callsById.get(chunk.toolCallId) ?? { id: chunk.toolCallId, name: 'unknown', args: {} };
            controller.enqueue({ type: 'tool-approval-request', approvalId: chunk.approvalId, toolCall: createToolCall(call, { providerExecuted: true }) });
            break;
          }

          // ── 文件：V4 data/url 变体 → GeneratedFile ──
          case 'file':
          case 'reasoning-file':
            controller.enqueue(v4FilePart(chunk));
            break;

          // ── 同形透传：Source = LanguageModelV4Source ──
          case 'source':
          case 'custom':
          case 'raw':
            controller.enqueue(chunk);
            break;

          // ── 响应元数据：捕获进 finish-step.response ──
          case 'response-metadata':
            responseMeta = { id: chunk.id, modelId: chunk.modelId, timestamp: chunk.timestamp };
            break;

          // ── V4 finish（单次调用级）→ finish-step（携带 response/usage/performance）──
          case 'finish':
            controller.enqueue(finishStepPart({
              usage: chunk.usage,
              finishReason: chunk.finishReason,
              providerMetadata: chunk.providerMetadata,
              response: responseMeta,
              startTime: stepStartTime,
              firstChunkTime,
            }));
            if (chunk.usage) {
              modelUsage.input = chunk.usage.inputTokens.total ?? 0;
              modelUsage.output = chunk.usage.outputTokens.total ?? 0;
            }
            break;

          case 'error':
            controller.enqueue({ type: 'error', error: chunk.error });
            const err = chunk.error instanceof Error ? chunk.error : String(chunk.error);
            return this.recordModelError(err, { text: fullText, reasoning: fullReasoning || undefined, toolCalls, usage: modelUsage });
        }
    }

    const result: CallModelResult = { text: fullText, reasoning: fullReasoning || undefined, toolCalls, usage: modelUsage };
    return result;
  }

  /**
   * 统一处理模型调用错误：emit 错误事件并返回带 error 的结果。
   * 调用方负责日志记录和 controller.enqueue。
   */
  private recordModelError(
    error: Error | string,
    result: CallModelResult,
  ): CallModelResult {
    this.emit({ type: 'error', error });
    return { ...result, error };
  }

}
