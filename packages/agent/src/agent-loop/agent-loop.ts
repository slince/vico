// @vico/agent - AgentLoop core engine: drives the model→tool→repeat loop for a single turn
import type {Logger} from 'pino';
import type {TurnEvent, UsageMetrics} from './types.js';
import type {ApprovalResolver, ToolCall, ToolResult} from '../tool/types.js';
import type {Thread, Turn} from '../thread/thread-store.js';
import {toToolDescriptor} from '../tool/create-tool.js';
import {resolvePolicy} from '../tool/utils.js';
import {TurnOutput} from './turn-output.js';
import type {Agent} from './agent.js';
import {ModelMessage, ModelRequest, ModelStreamChunk} from '../model/types.js';
import {ToolExecutor} from './tool-executor.js';
import type {TurnTracer} from '../observable/turn-tracer.js';
import {ContextCompactor} from './context-compactor.js';
import type {TokenEconomy} from './token-economy.js';
import type {ContextProcessor} from './context-processors/context-processor.js';
import {ModelRequestContext, ProcessorPipeline} from './context-processors/context-processor.js';
import {Span} from "../observable/types.js";
import {
  ApprovalClassification,
  CallModelResult,
  ModelStepResult,
  RunOptions,
  Step,
  StepLoopResult,
  ToolApproval,
  TurnContext,
  TurnResult,
  TurnSession
} from "./agent-loop-options.js";
import type {Checkpoint, CheckpointStore} from './checkpoint.js';
import {PauseInfo} from "./checkpoint.js";


/** AgentLoop 构造选项 */
export interface AgentLoopOptions {
  agent: Agent;
  processors?: ContextProcessor[];
}


/** AgentLoop — 编排 model→tool→repeat 循环 */
export class AgentLoop {
  private agent: Agent;
  toolExecutor: ToolExecutor;
  private compactor?: ContextCompactor;
  tokenEconomy?: TokenEconomy;
  private approvalResolver: ApprovalResolver;
  private tracer: TurnTracer;
  private pipeline: ProcessorPipeline;
  checkpointStore: CheckpointStore;

  constructor(options: AgentLoopOptions) {
    this.agent = options.agent;
    this.compactor = this.agent.compactor;
    this.tokenEconomy = this.agent.tokenEconomy;
    this.tracer = this.agent.tracer;
    this.approvalResolver = this.agent.approvalResolver ?? resolvePolicy;
    this.checkpointStore = this.agent.checkpointStore;
    this.toolExecutor = new ToolExecutor({ tools: options.agent.tools, host: this });
    this.pipeline = new ProcessorPipeline(options.processors ?? []);
  }

  get log(): Logger {
    return this.agent.logger;
  }

  /**
   * 执行一个 turn，同步返回 TurnOutput（含 ReadableStream 流和 result Promise）。
   * 历史消息由 Memory 自动补充。外部通过 TurnOutput.abort() 终止。
   *
   * @param userMessage - 用户消息
   * @param options - turn 运行可选参数
   * @returns TurnOutput 实例，包含输出流和结果 Promise
   */
  run(userMessage: ModelMessage, options?: RunOptions): TurnOutput {
    let resolveResult!: (result: TurnResult) => void;
    let rejectResult!: (err: Error|string) => void;
    const resultPromise = new Promise<TurnResult>((resolve, reject) => {
      resolveResult = resolve;
      rejectResult = reject;
    });

    const internalAc = new AbortController();

    const abort = () => {
      internalAc.abort();
    };

    const stream = new ReadableStream<ModelStreamChunk>({
      start: async (controller) => {
        try {
          const result = await this.start({userMessage, signal: internalAc.signal, controller, options});
          resolveResult(result);
        } catch (err) {
          const error = err instanceof Error ? err : String(err)
          this.emit({ type: 'error', error});
          rejectResult(error);
        } finally {
          try { controller.close(); } catch { /* already closed */ }
        }
      },
    });

    return new TurnOutput(stream, resultPromise, abort);
  }

  /**
   * runTurn 的核心逻辑，由 ReadableStream 的 start 回调调用。
   * 自动检测 thread 中是否存在 paused turn，有则恢复执行，无则创建新 turn。
   */
  private async start(ctx: {
    userMessage: ModelMessage;
    signal: AbortSignal;
    controller: ReadableStreamDefaultController<ModelStreamChunk>;
    options?: RunOptions;
  }): Promise<TurnResult> {
    const { userMessage, signal, controller, options } = ctx;
    const threadId = options?.threadId ?? `${this.agent.id}-${Date.now()}`;

    // 注意：getLatestTurn → createTurn 之间存在 check-then-act 窗口，
    // 并发请求可能同时判断无未完成 turn 并各自创建。依赖 threadStore 实现侧的并发控制。
    let thread = await this.agent.thread.getThread(threadId);
    if (!thread) {
      const title = userMessage.content.slice(0, 50);
      const workspace = options?.workspace ?? this.agent.workspace;
      const metadata = { ...options?.metadata, workspace };
      thread = await this.agent.thread.createThread(this.agent.id, title, threadId, { ...options, metadata });
      this.log.info({ threadId, agentId: this.agent.id }, 'thread created');
    }

    // 自动恢复所有未完成的 turn（paused/running/failed），前提是存在 checkpoint
    const latestTurn = await this.agent.thread.getLatestTurn(threadId);
    if (latestTurn && latestTurn.status !== 'completed') {
      const checkpoint = await this.checkpointStore.getByTurn(latestTurn.id);
      if (checkpoint) {
        this.log.info({ turnId: latestTurn.id, threadId, status: latestTurn.status }, 'resuming turn');
        return this.resumeTurn({thread, turn: latestTurn, checkpoint, userMessage, signal, controller, options});
      }
      this.log.info({ turnId: latestTurn.id, threadId, status: latestTurn.status }, 'uncompleted turn has no checkpoint, starting new turn');
    }

    // ── 正常新 turn ──
    return this.startTurn({ thread, userMessage, signal, controller, options });
  }

  /** 创建新的 turn 并开始执行 */
  private async startTurn(params: {
    thread: Thread;
    userMessage: ModelMessage;
    signal: AbortSignal;
    controller: ReadableStreamDefaultController<ModelStreamChunk>;
    options?: RunOptions;
  }): Promise<TurnResult> {
    const { thread, userMessage, signal, controller, options } = params;
    const turn = await this.agent.thread.createTurn(thread.id);
    this.log.info({ turnId: turn.id, threadId: thread.id }, 'turn started');
    const workspace = options?.workspace ?? thread.metadata?.workspace ?? this.agent.workspace;
    const session: TurnSession = { ...options, workspace, thread, turn };

    const usage: UsageMetrics = { input: 0, output: 0 };

    const trace = this.tracer.create(thread, userMessage, turn.id);
    const turnSpan = trace.startSpan('agent_run');
    const toolApprovalState = new Map<string, boolean>();

    const requestContext = new ModelRequestContext({agent: this.agent, userMessage, tools: [...this.agent.tools], session});
    await this.pipeline.enter(requestContext);

    const context: TurnContext = { ctx: requestContext, messages: [...requestContext.messages], session, trace, toolApprovalState, signal, controller };

    await this.persistMessage(userMessage, context);

    return this.startTurnLoop( 0, context, turnSpan, usage);
  }

  /** 从未完结的 turn 恢复执行，携带新的用户消息 */
  private async resumeTurn(params: {
    thread: Thread;
    turn: Turn;
    checkpoint: Checkpoint;
    userMessage: ModelMessage;
    signal: AbortSignal;
    controller: ReadableStreamDefaultController<ModelStreamChunk>;
    options?: RunOptions;
  }): Promise<TurnResult> {
    const { thread, turn, checkpoint, userMessage, signal, controller, options } = params;

    const usage: UsageMetrics = { input: 0, output: 0 };

    // 从 checkpoint 直接还原消息序列，无需从 thread store 重新加载
    const messages = [...checkpoint.messages];

    const { scopeId, workspace: optWorkspace, approvalDecisions } = options || {};
    const workspace = optWorkspace ?? thread.metadata?.workspace ?? this.agent.workspace;

    // 重建 session 和 context
    const session: TurnSession = { workspace, scopeId, thread, turn };
    const trace = this.tracer.create(thread, userMessage, turn.id);
    const turnSpan = trace.startSpan('agent_resume');

    const requestContext = new ModelRequestContext({agent: this.agent, userMessage, tools: [...this.agent.tools], session});
    await this.pipeline.enter(requestContext);

    // ——— checkpoint 恢复逻辑 ———
    const toolApprovalState = new Map<string, boolean>(Object.entries(checkpoint.toolApprovalState));
    const context: TurnContext = { ctx: requestContext, messages, session, trace, toolApprovalState, signal, controller };

    // 还原已完成工具结果到消息链（跳过已有的，并发保护）
    for (const result of checkpoint.completedToolResults) {
      if (!messages.some(m => m.role === 'tool' && m.toolCallId === result.callId)) {
        const content = this.resolveToolResult(result);
        const msg: ModelMessage = { role: 'tool', content, toolCallId: result.callId };
        messages.push(msg);
        await this.persistMessage(msg, context);
      }
    }

    if (checkpoint.pauseInfo) {
      // 路径 A：审批恢复
      this.log.info({ turnId: turn.id }, 'resume path A: approval recovery');
      await this.applyPauseInfoRecovery(checkpoint.pauseInfo, approvalDecisions || [], context);
      // 清除 pauseInfo
      await this.checkpointStore.save(turn.id, thread.id, { pauseInfo: null });
    } else if (checkpoint.pendingToolCall) {
      // 路径 B：工具重试
      this.log.info({ turnId: turn.id, toolName: checkpoint.pendingToolCall.name }, 'resume path B: tool retry');
      await this.resolvePendingTool(checkpoint.pendingToolCall, checkpoint, messages, context);
    } else {
      // 路径 C：pendingToolCall == null → 直接继续
      this.log.info({ turnId: turn.id }, 'resume path C: direct continue');
    }

    messages.push(userMessage);
    await this.persistMessage(userMessage, context);
    await this.agent.thread.updateTurn(turn.id, { status: 'running' });
    return this.startTurnLoop(checkpoint.stepIndex, context, turnSpan, usage);
  }

  /**
   * 从 pauseInfo 恢复工具调用：执行自动批准的调用、追加自动拒绝的结果、
   * 处理等待审批的调用（根据 approvalDecisions 决定执行或拒绝）。
   */
  private async applyPauseInfoRecovery(pauseInfo: PauseInfo, decisions: ToolApproval[], context: TurnContext): Promise<void> {
    if (pauseInfo.reason !== 'tool-approval') return;

    const decisionMap = new Map(decisions.map(d => [d.toolCallId, d.approved]));

    // 1. 执行暂停前已自动批准的调用（executeToolCalls 内部逐条持久化）
    if (pauseInfo.autoApprovedCalls && pauseInfo.autoApprovedCalls.length > 0) {
      await this.toolExecutor.executeToolCalls(pauseInfo.autoApprovedCalls, context);
    }

    // 2. 持久化暂停前已自动拒绝的结果
    if (pauseInfo.autoDeniedResults && pauseInfo.autoDeniedResults.length > 0) {
      await this.appendToolResults(pauseInfo.autoDeniedResults, context);
    }

    // 3. 处理等待审批的调用
    const approvedCalls: ToolCall[] = [];
    const deniedResults: ToolResult[] = [];

    for (const pendingCall of pauseInfo.pendingToolCalls) {
      const approved = decisionMap.get(pendingCall.id) ?? false;
      if (approved) {
        approvedCalls.push(pendingCall);
        // 追踪到 toolApprovalState，确保同一 turn 后续 step 中该工具自动放行
        context.toolApprovalState.set(pendingCall.name, true);
      } else {
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
    pending: { id: string; name: string; args: Record<string, unknown> },
    checkpoint: Checkpoint,
    messages: ModelMessage[],
    context: TurnContext,
  ): Promise<void> {
    const turnId = context.session.turn.id;
    const threadId = context.session.thread.id;

    // 检查消息链中是否已有此 toolCall 的 tool_result（并发保护）
    const alreadyResolved = messages.some(
      m => m.role === 'tool' && m.toolCallId === pending.id
    );

    if (alreadyResolved) {
      // 跳过执行，从消息链提取已有结果并更新 checkpoint
      const existingResult: ToolResult = {
        callId: pending.id,
        name: pending.name,
        status: 'success',
        output: messages.find(m => m.role === 'tool' && m.toolCallId === pending.id)?.content ?? null,
      };
      await this.checkpointStore.save(turnId, threadId, {
        completedToolCallIds: [...checkpoint.completedToolCallIds, pending.id],
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
  private async startTurnLoop(startStep: number, context: TurnContext, turnSpan: Span, usage: UsageMetrics): Promise<TurnResult> {

    const {session: {thread, turn}, trace} = context
    const loopResult: StepLoopResult  = await this.runTurnLoop(startStep, context);
    usage.input += loopResult.usage.input;
    usage.output += loopResult.usage.output;

    // 暂停时不 finalize trace session，保留会话供恢复时复用
    if (loopResult.finalStatus === 'paused') {
      this.log.info({ turnId: turn.id, steps: loopResult.steps }, 'turn paused');
      turnSpan.end({ status: 'paused', steps: loopResult.steps });
      return {
        status: 'paused', steps: loopResult.steps, usage, messages: context.messages, thread, turn,
      };
    }

    await this.pipeline.leave(context.ctx);

    // 模型错误导致的失败
    if (loopResult.finalStatus === 'failed') {
      const err = loopResult.error!;
      this.log.error({ turnId: turn.id, error: err instanceof Error ? err.message : String(err) }, 'turn failed');
      await this.agent.thread.updateTurn(turn.id, { status: 'failed', steps: loopResult.steps });
      turnSpan.error(err instanceof Error ? err : String(err));
      this.emit({ type: 'error', error: err });

      const failResult: TurnResult = {
        status: 'failed', steps: loopResult.steps, usage, messages: context.messages,
        thread, turn, error: loopResult.error,
      };
      await this.tracer.finish(trace, failResult, turn.id);
      return failResult;
    }

    const finalStatus = loopResult.finalStatus === 'aborted' ? 'aborted' : 'completed';
    await this.agent.thread.updateTurn(turn.id, { status: finalStatus, steps: loopResult.steps });

    // completed 终态：清理 checkpoint
    if (finalStatus === 'completed') {
      this.log.info({ turnId: turn.id, steps: loopResult.steps }, 'turn completed, cleaning checkpoint');
      await this.checkpointStore.deleteByTurn(turn.id);
    }

    turnSpan.end({ status: 'completed', steps: loopResult.steps });
    this.emit({ type: 'done', usage });

    const finalResult: TurnResult = {
      status: loopResult.finalStatus === 'aborted'
        ? (context.signal.aborted ? 'interrupted' : 'aborted')
        : 'completed',
      steps: loopResult.steps,
      usage,
      messages: context.messages,
      thread,
      turn,
    };
    await this.tracer.finish(trace, finalResult, turn.id);
    return finalResult;
  }

  /**
   * 执行 step loop，被 startLoop（新 turn）和 startResume（恢复）共用。
   */
  private async runTurnLoop(startStep: number, context: TurnContext,): Promise<StepLoopResult> {
    const usage = { input: 0, output: 0 };
    let steps = startStep;

    const {session: {turn}, signal} = context

    while (steps < this.agent.maxSteps && !signal.aborted) {
      const step: Step = { index: steps, messages: context.messages };
      const { action, pauseInfo, usage: stepUsage, error } = await this.executeModelStep(step, context);
      usage.input += stepUsage.input;
      usage.output += stepUsage.output;

      if (action === 'pause') {
        // 持久化暂停信息到 checkpoint（替代 turn.metadata）
        await this.checkpointStore.save(turn.id, context.session.thread.id, {
          pauseInfo,
          toolApprovalState: Object.fromEntries(context.toolApprovalState),
          messages: [...context.messages],
          stepIndex: steps,
        });
        await this.agent.thread.updateTurn(turn.id, { status: 'paused', steps });
        return { finalStatus: 'paused', steps, usage };
      }

      if (action === 'break') {
        // 如果是因为模型错误 直接短路
        if (error) {
          return { finalStatus: 'failed', steps, usage, error };
        }
        break
      }
      steps++;
    }

    return { finalStatus: signal.aborted ? 'aborted' : 'completed', steps, usage };
  }

  /**
   * 执行一个 model step：压缩 → model 调用 → 审批 → 工具执行 → 持久化。
   */
  private async executeModelStep(step: Step, context: TurnContext): Promise<ModelStepResult> {
    this.emit({ type: 'step-start', step: step.index + 1 });
    this.log.debug({ turnId: context.session.turn.id, step: step.index, messageCount: context.messages.length }, 'step start');

    // step-start checkpoint：记录当前 step 进度和消息快照
    await this.checkpointStore.save(context.session.turn.id, context.session.thread.id, {
      stepIndex: step.index,
      pendingToolCall: null,
      messages: [...context.messages],
      lastMessageId: null,
      toolApprovalState: Object.fromEntries(context.toolApprovalState),
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

    // 模型输出后的消息处理
    if (modelResult.text || modelResult.toolCalls.length > 0) {
      const assistantMsg = { role: 'assistant' as const, content: modelResult.text, ...(modelResult.toolCalls.length > 0 && { toolCalls: modelResult.toolCalls }) };
      context.messages.push(assistantMsg);

      await this.persistMessage(assistantMsg, context);
    }

    if (modelResult.toolCalls.length === 0) {
      this.emit({ type: 'step-end', step: step.index + 1 });
      return { action: 'break', usage };
    }

    // 审批 + 执行 + 持久化
    const { approvedCalls, deniedResults, pausedCalls } = await this.resolveToolApprovals(modelResult.toolCalls, context);

    // 有待审批的工具 → 暂停 turn
    // 注意：assistant(toolCalls) 消息已持久化到 DB（用于恢复），但需从内存 messages 中移除，
    // 因为未决的 tool_use 不能出现在发给模型的后续请求中
    if (pausedCalls.length > 0) {
      this.log.info({ turnId: context.session.turn.id, step: step.index, pausedCount: pausedCalls.length, toolNames: pausedCalls.map(c => c.name) }, 'tool approval required, pausing turn');

      const pauseInfo: PauseInfo = {
        reason: 'tool-approval',
        pendingToolCalls: pausedCalls,
        // 保存已在审批阶段自动决策的调用，恢复时直接使用，避免重复审批
        autoApprovedCalls: approvedCalls,
        autoDeniedResults: deniedResults,
        pausedAtStep: step.index,
        messageCount: context.messages.length,
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
  private async resolveToolApprovals(toolCalls: ToolCall[], context: TurnContext): Promise<ApprovalClassification> {
    const approvedCalls: ToolCall[] = [];
    const deniedResults: ToolResult[] = [];
    const pausedCalls: ToolCall[] = [];

    for (const call of toolCalls) {
      const tool = this.toolExecutor.findTool(call.name);
      const policy = tool?.policy ?? 'auto';

      const isFirstUse = !context.toolApprovalState.has(call.name);
      const wasApproved = context.toolApprovalState.get(call.name) ?? false;

      // 工具未注册 → 直接拒绝
      if (!tool) {
        deniedResults.push({
          callId: call.id, name: call.name,
          status: 'error', output: null,
          error: `Tool "${call.name}" 未找到`,
        });
        continue;
      }

      const decision = await this.approvalResolver(call, tool, policy, {
        firstUse: isFirstUse,
        previousApproved: wasApproved,
      });

      if (decision.approved) {
        context.toolApprovalState.set(call.name, true);
        approvedCalls.push(call);
        continue;
      }

      // on-request 工具首次使用 → 暂停等待外部审批，不直接拒绝
      if (policy === 'on-request' && isFirstUse && !wasApproved) {
        // use toolCallId as approvalId so the client’s tool-approval-response maps directly
        context.controller.enqueue({
          type: 'tool-approval-request',
          approvalId: call.id,
          toolCallId: call.id,
          toolName: call.name,
          input: call.args,
        });
        this.emit({
          type: 'tool-approval-request',
          approvalId: call.id,
          toolCallId: call.id,
          toolName: call.name,
          input: call.args,
        });
        pausedCalls.push(call);
        continue;
      }

      deniedResults.push({
        callId: call.id, name: call.name,
        status: 'error', output: null,
        error: decision.reason ?? '被策略阻止',
      });
    }

    return { approvedCalls, deniedResults, pausedCalls };
  }

  /**
   * 持久化单条消息到 threadStore。
   */
  async persistMessage(message: ModelMessage, context: TurnContext): Promise<void> {
    await this.agent.thread.appendEntry({
      threadId: context.session.thread.id,
      turnId: context.session.turn.id,
      role: message.role,
      content: message.content,
      toolCalls: message.toolCalls,
      toolCallId: message.toolCallId,
    });
  }

  /**
   * 发射事件到订阅者（箭头函数绑定 this，可直接作为回调传递）。
   */
  emit = (event: TurnEvent): void => {
    this.agent.events.emit(event);
  };

  /** 将 ToolResult 转为消息文本，可选 token 截断 */
  resolveToolResult(r: ToolResult): string {
    const raw = r.status === 'success'
      ? (typeof r.output === 'string' ? r.output : JSON.stringify(r.output))
      : (r.error instanceof Error ? r.error.message : (r.error ?? 'tool execution failed'));
    return this.tokenEconomy?.truncateToolOutput(raw) ?? raw;
  }

  /** 工具结果 → 消息 + 持久化 */
  async appendToolResults(toolResults: ToolResult[], context: TurnContext): Promise<void> {
    for (const r of toolResults) {
      const content = this.resolveToolResult(r);
      const message: ModelMessage = { role: 'tool', content, toolCallId: r.callId };
      context.messages.push(message);
      await this.persistMessage(message, context);
    }
  }

  /**
   * 压缩检查，按需原地替换 messages。
   */
  private async tryCompact(step: Step, signal: AbortSignal): Promise<void> {
    if (!this.compactor) return;
    const result = await this.compactor.compactIfNeeded(step.messages, this.agent.modelClient, signal);
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
  private async callModel(step: Step, context: TurnContext): Promise<CallModelResult> {
    const { ctx, trace, controller } = context;
    const modelUsage = { input: 0, output: 0 };

    const request: ModelRequest = {
      system: ctx.systemPrompt,
      messages: step.messages,
      tools: ctx.tools.map(toToolDescriptor),
      maxOutputTokens: this.agent.maxTokens,
      temperature: this.agent.temperature,
    };

    let fullText = '';
    const toolCalls: ToolCall[] = [];
    const modelSpan = trace.startSpan('model_step', { step: step.index + 1 });

    // 记录 LLM 请求参数（原始对象直接传入，tracer 内部提取）
    trace.recordModelRequest(step.index, request);

    try {
      this.log.debug({ step: step.index, turnId: context.session.turn.id, messages: step.messages.length, tools: request.tools?.length }, 'model request')

      console.log("model request", request)

      const { stream } = await this.agent.modelClient.stream(request, context.signal);

      for await (const chunk of stream) {
        switch (chunk.type) {
            case 'text-start':
            case 'text-end':
            case 'tool-input-start':
            case 'tool-input-delta':
            case 'tool-input-end':
            case 'tool-result':
            case 'file':
            case 'source':
              controller.enqueue(chunk);
              break;

            case 'text-delta':
              controller.enqueue(chunk);
              fullText += chunk.delta;
              this.emit({ type: 'text-delta', content: chunk.delta });
              break;

            case 'reasoning-start':
            case 'reasoning-end':
              controller.enqueue(chunk);
              break;

            case 'reasoning-delta':
              controller.enqueue(chunk);
              this.emit({ type: 'reasoning-delta', content: chunk.delta });
              break;

            case 'tool-call':
              controller.enqueue(chunk);
              toolCalls.push({ id: chunk.toolCallId, name: chunk.toolName, args: (chunk.input ?? {}) as Record<string, unknown> });
              this.emit({ type: 'tool-call-start', id: chunk.toolCallId, name: chunk.toolName, args: (chunk.input ?? {}) as Record<string, unknown> });
              break;

            case 'tool-approval-request':
              controller.enqueue(chunk);
              break;

            case 'finish':
              controller.enqueue(chunk);
              if (chunk.usage) {
                modelUsage.input = chunk.usage.inputTokens.total ?? 0;
                modelUsage.output = chunk.usage.outputTokens.total ?? 0;
              }
              break;

            case 'error':
              controller.enqueue(chunk);
              const err = chunk.error instanceof Error ? chunk.error : String(chunk.error);
              modelSpan.error(err);
              this.emit({ type: 'error', error: err });
              trace.recordModelResponse(step.index, { text: fullText, toolCalls, usage: modelUsage, error: err });
              return { text: fullText, toolCalls, usage: modelUsage, error: err };
            // stream-start/response-metadata/raw：内部使用
          }
      }

      modelSpan.end({ textLength: fullText.length, toolCalls: toolCalls.length });

      const result: CallModelResult = { text: fullText, toolCalls, usage: modelUsage };
      trace.recordModelResponse(step.index, result);
      return result;
    } catch (err) {
      const error = err instanceof Error ? err : String(err);

      console.log("error", error);

      this.log.error({ step: step.index, turnId: context.session.turn.id, error: error instanceof Error ? error.message : String(error) }, 'model stream error');
      controller.enqueue({type: 'error', error: error});
      modelSpan.error(error);
      this.emit({ type: 'error', error: error });
      const errorResult: CallModelResult = { text: fullText, toolCalls, usage: modelUsage, error: error };
      trace.recordModelResponse(step.index, errorResult);
      return errorResult;
    }
  }

}
