// @vico/agent - AgentLoop core engine: drives the model→tool→repeat loop for a single turn
import type {
  PauseInfo,
  RunOptions,
  Step,
  StepLoopResult,
  ToolApproval,
  TurnEvent,
  TurnResult,
  TurnSession,
  UsageMetrics
} from './types.js';
import type {ApprovalResolver, ToolCall, ToolCallContext, ToolResult} from '../tool/types.js';
import type {Thread, ThreadContext, Turn} from '../thread/types.js';
import {toToolDescriptor} from '../tool/create-tool.js';
import {resolvePolicy} from '../tool/utils.js';
import {TurnOutput} from './turn-output.js';
import type {Agent} from './agent.js';
import type {ModelMessage, ModelRequest, ModelStreamChunk} from '../model/types.js';
import {ToolBroker} from '../tool/tool-broker.js';
import type {TurnTrace, TurnTracer} from '../observable/turn-tracer.js';
import {ContextCompactor} from './context-compactor.js';
import type {TokenEconomy} from './token-economy.js';
import type {ContextProcessor} from './context-processors/context-processor.js';
import {ModelRequestContext, ProcessorPipeline} from './context-processors/context-processor.js';
import {Span} from "../observable/types.js";

/** executeModelStep 的返回值 */
export interface ModelStepResult {
  /** 是否终止循环 */
  shouldBreak: boolean;
  /** 是否需要暂停等待外部审批 */
  shouldPause: boolean;
  /** 暂停信息（shouldPause 为 true 时需要） */
  pauseInfo?: PauseInfo;
  /** 本 step 的 token 用量 */
  usage: UsageMetrics;
  /** 本step是否执行出错*/
  error?: Error | string;
}

/** 审批分类结果 */
export interface ApprovalClassification {
  approvedCalls: ToolCall[];
  deniedResults: ToolResult[];
  pausedCalls: ToolCall[];
}

/** callModel 的返回值 */
export interface CallModelResult {
  /** 模型生成的完整文本 */
  text: string;
  /** 模型请求的工具调用 */
  toolCalls: ToolCall[];
  /** 本次调用的 token 用量 */
  usage: UsageMetrics;
  /** 错误信息（如有） */
  error?: string | Error;
}

/** executeModelStep / callModel 共享上下文 */
export interface TurnContext {
  ctx: ModelRequestContext
  messages: ModelMessage[]
  session: TurnSession;
  trace: TurnTrace;
  toolApprovalState: Map<string, boolean>;
  /** turn 级中断信号，贯穿 model 调用和工具执行 */
  signal: AbortSignal;
  /** 流控制器，用于向客户端推送 chunk */
  controller: ReadableStreamDefaultController<ModelStreamChunk>;
}

/** AgentLoop 构造选项 */
export interface AgentLoopOptions {
  agent: Agent;
  processors?: ContextProcessor[];
  compactor?: ContextCompactor;
  tokenEconomy?: TokenEconomy;
}


/** AgentLoop — 编排 model→tool→repeat 循环 */
export class AgentLoop {
  private agent: Agent;
  private toolBroker: ToolBroker;
  private compactor?: ContextCompactor;
  private tokenEconomy?: TokenEconomy;
  private approvalResolver: ApprovalResolver;
  private tracer: TurnTracer;
  private pipeline: ProcessorPipeline;

  constructor(options: AgentLoopOptions) {
    this.agent = options.agent;
    this.toolBroker = new ToolBroker(options.agent.tools);
    this.compactor = options.compactor;
    this.tokenEconomy = options.tokenEconomy;
    this.tracer = options.agent.tracer;
    this.approvalResolver = options.agent.approvalResolver ?? resolvePolicy;
    this.pipeline = new ProcessorPipeline(options.processors ?? []);
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
    let rejectResult!: (err: Error) => void;
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
          const result = await this.startLoop({userMessage, signal: internalAc.signal, controller, options});
          resolveResult(result);
        } catch (err) {
          this.emit({ type: 'error', error: err instanceof Error ? err : String(err) });
          rejectResult(err instanceof Error ? err : new Error(String(err)));
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
  private async startLoop(ctx: {
    userMessage: ModelMessage;
    signal: AbortSignal;
    controller: ReadableStreamDefaultController<ModelStreamChunk>;
    options?: RunOptions;
  }): Promise<TurnResult> {
    const { userMessage, signal, controller, options } = ctx;
    const threadId = options?.threadId ?? `${this.agent.id}-${Date.now()}`;
    const usage = { input: 0, output: 0 };

    // 注意：getLatestTurn → createTurn 之间存在 check-then-act 窗口，
    // 并发请求可能同时判断无未完成 turn 并各自创建。依赖 threadStore 实现侧的并发控制。
    let thread = await this.agent.thread.getThread(threadId);
    if (!thread) {
      const title = userMessage.content.slice(0, 50);
      thread = await this.agent.thread.createThread(this.agent.id, title, threadId, options as ThreadContext);
    }

    // 自动恢复所有未完成的 turn（paused/running/failed），
    // resumeTurn 内置消息链愈合逻辑，能自动补齐缺失的 tool_result
    const latestTurn = await this.agent.thread.getLatestTurn(threadId);
    if (latestTurn && latestTurn.status !== 'completed') {
      return this.resumeTurn({thread, turn: latestTurn, userMessage, signal, controller, options, usage});
    }

    // ── 正常新 turn ──
    return this.startTurn({ thread, userMessage, signal, controller, options, usage });
  }

  /** 创建新的 turn 并开始执行 */
  private async startTurn(params: {
    thread: Thread;
    userMessage: ModelMessage;
    signal: AbortSignal;
    controller: ReadableStreamDefaultController<ModelStreamChunk>;
    options?: RunOptions;
    usage: UsageMetrics;
  }): Promise<TurnResult> {
    const { thread, userMessage, signal, controller, options, usage } = params;
    const turn = await this.agent.thread.createTurn(thread.id);
    const session: TurnSession = { ...options, thread, turn };

    const trace = this.tracer.create(thread, userMessage, turn.id);
    const turnSpan = trace.startSpan('agent_run');
    const toolApprovalState = new Map<string, boolean>();

    const requestContext = new ModelRequestContext({
      agent: this.agent,
      userMessage,
      tools: [...this.agent.tools],
      session,
    });
    await this.pipeline.enter(requestContext);

    await this.agent.thread.appendEntry({
      threadId: thread.id,
      turnId: turn.id,
      role: userMessage.role,
      content: userMessage.content,
    });

    const messages: ModelMessage[] = [...requestContext.messages];
    const context: TurnContext = { ctx: requestContext, messages, session, trace, toolApprovalState, signal, controller };

    return this.startTurnLoop( 0, context, turnSpan, usage);
  }

  /** 从未完结的 turn 恢复执行，携带新的用户消息 */
  private async resumeTurn(params: {
    thread: Thread;
    turn: Turn;
    userMessage: ModelMessage;
    signal: AbortSignal;
    controller: ReadableStreamDefaultController<ModelStreamChunk>;
    options?: RunOptions;
    usage: UsageMetrics;
  }): Promise<TurnResult> {
    const { thread, turn, userMessage, signal, controller, options, usage } = params;
    const threadStore = this.agent.thread;

    // 加载该 turn 的 messages
    const entries = await threadStore.getEntriesByTurn(turn.id);
    const messages: ModelMessage[] = entries.map(e => {
      const msg: ModelMessage = { role: e.role as ModelMessage['role'], content: e.content };
      if (e.toolCallId) msg.toolCallId = e.toolCallId;
      if (e.toolCalls) msg.toolCalls = e.toolCalls as ModelMessage['toolCalls'];
      return msg;
    });

    const {scopeId, workspace, approvalDecisions} = options || {}

    // 重建 session 和 context
    const session: TurnSession = { workspace, scopeId, thread, turn };
    const trace = this.tracer.create(thread, userMessage, turn.id);
    const turnSpan = trace.startSpan('agent_resume');
    const toolApprovalState = new Map<string, boolean>();

    const requestContext = new ModelRequestContext({
      agent: this.agent,
      userMessage,
      tools: [...this.agent.tools],
      session,
    });
    await this.pipeline.enter(requestContext);

    const context: TurnContext = { ctx: requestContext, messages, session, trace, toolApprovalState, signal, controller };

    let startStep = turn.steps;

    // ── 消息链自检与愈合 ──
    // 无论 turn 是 paused（有 pauseInfo）还是 running/failed（无 pauseInfo），
    // 都必须先确保 assistant(toolCalls) → tool_result 链完整，再追加用户消息。
    // 否则模型 API 会因 tool_use 缺少 tool_result 而拒绝请求。
    const pauseInfo = turn.metadata?.pauseInfo as PauseInfo | undefined;

    if (pauseInfo) {
      // 路径 A：有 pauseInfo → 标准暂停恢复流程
      await this.applyPauseInfoRecovery(pauseInfo, approvalDecisions || [], context);
      startStep = pauseInfo.pausedAtStep + 1;
    } else {
      // 路径 B：无 pauseInfo → 愈合模式，补齐缺失的 tool_result
      const healResult = await this.healTurnMessages(messages, context, thread, turn, startStep, usage);
      if (healResult) return healResult;
    }

    // ── 消息链已完整，安全追加用户消息 ──
    messages.push(userMessage);
    await threadStore.appendEntry({
      threadId: thread.id,
      turnId: turn.id,
      role: userMessage.role,
      content: userMessage.content,
    });

    // 恢复 turn 状态为 running
    await threadStore.updateTurn(turn.id, { status: 'running' });

    return this.startTurnLoop(startStep, context, turnSpan, usage);
  }

  /**
   * 从 pauseInfo 恢复工具调用：执行自动批准的调用、追加自动拒绝的结果、
   * 处理等待审批的调用（根据 approvalDecisions 决定执行或拒绝）。
   */
  private async applyPauseInfoRecovery(pauseInfo: PauseInfo, decisions: ToolApproval[], context: TurnContext): Promise<void> {
    if (pauseInfo.reason !== 'tool-approval') return;

    const decisionMap = new Map(decisions.map(d => [d.toolCallId, d.approved]));
    const toolResults: ToolResult[] = [];

    // 1. 执行暂停前已自动批准的调用
    if (pauseInfo.autoApprovedCalls && pauseInfo.autoApprovedCalls.length > 0) {
      toolResults.push(...await this.executeToolCalls(pauseInfo.autoApprovedCalls, context));
    }

    // 2. 追加暂停前已自动拒绝的结果
    if (pauseInfo.autoDeniedResults) {
      toolResults.push(...pauseInfo.autoDeniedResults);
    }

    // 3. 处理等待审批的调用
    const approvedCalls: ToolCall[] = [];
    const deniedResults: ToolResult[] = [];

    for (const pendingCall of pauseInfo.pendingToolCalls) {
      const approved = decisionMap.get(pendingCall.id) ?? false;
      if (approved) {
        approvedCalls.push(pendingCall);
      } else {
        deniedResults.push({
          callId: pendingCall.id, name: pendingCall.name,
          status: 'error', output: null,
          error: 'Rejected by user',
        });
      }
    }

    toolResults.push(...await this.executeToolCalls(approvedCalls, context));
    toolResults.push(...deniedResults);

    await this.appendToolResults(toolResults, context);
  }

  /**
   * 愈合模式：扫描消息中未完成的 toolCalls，补齐缺失的 tool_result。
   * 若愈合过程中遇到需要用户审批的工具，则重新暂停 turn。
   *
   * @returns TurnResult 如果愈合过程中暂停，否则 null 表示继续恢复流程
   */
  private async healTurnMessages(
    messages: ModelMessage[],
    context: TurnContext,
    thread: Thread,
    turn: Turn,
    startStep: number,
    usage: UsageMetrics,
  ): Promise<TurnResult | null> {
    const unresolvedCalls = this.findUnresolvedToolCalls(messages);
    if (!unresolvedCalls || unresolvedCalls.length === 0) return null;

    const { approvedCalls, deniedResults, pausedCalls } = await this.resolveToolApprovals(unresolvedCalls, context);

    if (pausedCalls.length > 0) {
      const newPauseInfo: PauseInfo = {
        reason: 'tool-approval',
        pendingToolCalls: pausedCalls,
        autoApprovedCalls: approvedCalls,
        autoDeniedResults: deniedResults,
        pausedAtStep: startStep,
        messageCount: messages.length,
      };

      await this.agent.thread.updateTurn(turn.id, { status: 'paused', steps: startStep, metadata: { pauseInfo: newPauseInfo } });

      return {
        status: 'paused', steps: startStep, usage, messages, turnId: turn.id, threadId: thread.id,
      };
    }

    // 全部可自动处理 → 执行并追加 tool_results
    const toolResults = await this.executeToolCalls(approvedCalls, context);
    toolResults.push(...deniedResults);

    await this.appendToolResults(toolResults, context);
    return null;
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
      turnSpan.end({ status: 'paused', steps: loopResult.steps });
      return {
        status: 'paused', steps: loopResult.steps, usage, messages: context.messages, turnId: turn.id, threadId: thread.id,
      };
    }

    await this.pipeline.leave(context.ctx);

    // 模型错误导致的失败
    if (loopResult.finalStatus === 'failed') {
      const err = loopResult.error!;
      await this.agent.thread.updateTurn(turn.id, { status: 'failed', steps: loopResult.steps });
      turnSpan.error(err instanceof Error ? err : String(err));
      this.emit({ type: 'error', error: err });

      const failResult: TurnResult = {
        status: 'failed', steps: loopResult.steps, usage, messages: context.messages,
        turnId: turn.id, threadId: thread.id, error: loopResult.error,
      };
      await this.tracer.finish(trace, failResult, turn.id);
      return failResult;
    }

    const finalStatus = loopResult.finalStatus === 'aborted' ? 'aborted' : 'completed';
    await this.agent.thread.updateTurn(turn.id, { status: finalStatus, steps: loopResult.steps });

    turnSpan.end({ status: 'completed', steps: loopResult.steps });
    this.emit({ type: 'done', usage });

    const finalResult: TurnResult = {
      status: loopResult.finalStatus === 'aborted'
        ? (context.signal.aborted ? 'interrupted' : 'aborted')
        : 'completed',
      steps: loopResult.steps,
      usage,
      messages: context.messages,
      turnId: turn.id,
      threadId: thread.id,
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
      const { shouldBreak, shouldPause, pauseInfo, usage: stepUsage, error } = await this.executeModelStep(step, context);
      usage.input += stepUsage.input;
      usage.output += stepUsage.output;

      if (shouldPause && pauseInfo) {
        // 持久化暂停信息到 turn.metadata
        await this.agent.thread.updateTurn(turn.id, { status: 'paused', steps, metadata: { pauseInfo } });
        return { finalStatus: 'paused', steps, usage };
      }

      if (shouldBreak) {
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

    const usage = { input: 0, output: 0 };

    await this.tryCompact(step, context.signal);

    if (this.tokenEconomy?.isInputExhausted()) {
      this.emit({ type: 'error', error: '输入 token 预算已耗尽' });
      return { shouldBreak: true, shouldPause: false, usage };
    }

    if (this.tokenEconomy?.isOutputExhausted()) {
      this.emit({ type: 'error', error: '输出 token 预算已耗尽' });
      return { shouldBreak: true, shouldPause: false, usage };
    }

    const modelResult = await this.callModel(step, context);

    // 如果模型调用出错，提前结束
    if (modelResult.error) {
      return { shouldBreak: true, shouldPause: false, usage, error: modelResult.error };
    }

    // 模型返回后检查中断信号，避免在已取消的 turn 中继续执行工具
    if (context.signal.aborted) {
      return { shouldBreak: true, shouldPause: false, usage };
    }

    usage.input += modelResult.usage.input;
    usage.output += modelResult.usage.output;
    this.tokenEconomy?.track(modelResult.usage.input, modelResult.usage.output);

    // 模型输出后的消息处理
    if (modelResult.text || modelResult.toolCalls.length > 0) {
      const assistantMsg = { role: 'assistant' as const, content: modelResult.text, ...(modelResult.toolCalls.length > 0 && { toolCalls: modelResult.toolCalls }) };
      context.messages.push(assistantMsg);

      await this.agent.thread.appendEntry({
        threadId: context.session.thread.id,
        turnId: context.session.turn.id,
        role: assistantMsg.role,
        content: assistantMsg.content,
        toolCalls: assistantMsg.toolCalls,
      });
    }

    if (modelResult.toolCalls.length === 0) {
      this.emit({ type: 'step-end', step: step.index + 1 });
      return { shouldBreak: true, shouldPause: false, usage };
    }

    // 审批 + 执行 + 持久化
    const { approvedCalls, deniedResults, pausedCalls } = await this.resolveToolApprovals(modelResult.toolCalls, context);

    // 有待审批的工具 → 暂停 turn
    // 注意：assistant(toolCalls) 消息已持久化到 DB（用于恢复），但需从内存 messages 中移除，
    // 因为未决的 tool_use 不能出现在发给模型的后续请求中
    if (pausedCalls.length > 0) {
      context.messages.pop(); // 移除内存中的 assistant 消息，DB 中保留用于恢复

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
      return { shouldBreak: false, shouldPause: true, pauseInfo, usage };
    }

    const toolResults = await this.executeToolCalls(approvedCalls, context);
    toolResults.push(...deniedResults);

    await this.appendToolResults(toolResults, context);

    this.emit({ type: 'step-end', step: step.index + 1 });
    return { shouldBreak: false, shouldPause: false, usage };
  }

  /**
   * 解析工具审批：遍历 toolCalls，按策略分类为 approvedCalls / deniedResults / pausedCalls。
   */
  private async resolveToolApprovals(toolCalls: ToolCall[], context: TurnContext): Promise<ApprovalClassification> {
    const approvedCalls: ToolCall[] = [];
    const deniedResults: ToolResult[] = [];
    const pausedCalls: ToolCall[] = [];

    for (const call of toolCalls) {
      const tool = this.toolBroker.findTool(call.name);
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
   * 将工具结果追加到 messages 并持久化到 threadStore。
   */
  private async appendToolResults(toolResults: ToolResult[], context: TurnContext): Promise<void> {
    for (const r of toolResults) {
      const raw = r.status === 'success'
        ? (typeof r.output === 'string' ? r.output : JSON.stringify(r.output))
        : (r.error instanceof Error ? r.error.message : (r.error ?? 'tool execution failed'));
      const truncated = this.tokenEconomy?.truncateToolOutput(raw) ?? raw;
      context.messages.push({ role: 'tool', content: truncated, toolCallId: r.callId });
      await this.agent.thread.appendEntry({
        threadId: context.session.thread.id,
        turnId: context.session.turn.id,
        role: 'tool',
        content: truncated,
        toolCallId: r.callId,
      });
    }
  }

  /**
   * 发射事件到订阅者（箭头函数绑定 this，可直接作为回调传递）。
   */
  private emit = (event: TurnEvent): void => {
    this.agent.events.emit(event);
  };

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
      console.log("call model error", err);
      const error = err instanceof Error ? err : String(err);
      controller.enqueue({type: 'error', error: error});
      modelSpan.error(error);
      this.emit({ type: 'error', error: error });
      const errorResult: CallModelResult = { text: fullText, toolCalls, usage: modelUsage, error: error };
      trace.recordModelResponse(step.index, errorResult);
      return errorResult;
    }
  }

  /**
   * 执行工具调用，返回结果数组。不修改入参，事件通过 emit 触发。
   */
  private async executeToolCalls(toolCalls: ToolCall[], context: TurnContext): Promise<ToolResult[]> {
    if (toolCalls.length === 0) return [];

    const toolSpan = context.trace.startSpan('tool_call', { count: toolCalls.length });
    const toolCallContext: ToolCallContext = {session: context.session, agentId: this.agent.id, signal: context.signal};
    const results = await this.toolBroker.executeBatch(toolCalls, toolCallContext);

    toolSpan.end({ results: results.length });

    for (const r of results) {
      this.emit({
        type: 'tool-result',
        id: r.callId,
        name: r.name,
        status: r.status,
        output: r.output,
      });
    }
    return results;
  }

  /**
   * 扫描 messages 中最后一条 assistant 消息，返回未被 tool_result 覆盖的 toolCalls。
   * 用于 turn 恢复时的消息链愈合：补齐崩溃/重启后缺失的 tool_result。
   *
   * @param messages - 当前消息数组
   * @returns 未解决的 ToolCall 数组，无需愈合时返回 null
   */
  private findUnresolvedToolCalls(messages: ModelMessage[]): ToolCall[] | null {
    // 从后往前找最后一条 assistant 消息（含 toolCalls）
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (msg.role === 'assistant' && msg.toolCalls && Array.isArray(msg.toolCalls) && msg.toolCalls.length > 0) {
        // 收集该 assistant 消息之后所有 tool_result 的 ID
        const resolvedIds = new Set<string>();
        for (let j = i + 1; j < messages.length; j++) {
          const tcId = messages[j].toolCallId;
          if (messages[j].role === 'tool' && tcId) {
            resolvedIds.add(tcId);
          }
        }
        const toolCalls = msg.toolCalls;
        const unresolved = toolCalls.filter(tc => !resolvedIds.has(tc.id));
        if (unresolved.length > 0) {
          return unresolved
        }
        // 该 assistant 消息的所有 toolCalls 已解决，继续检查更早的消息
        // （正常情况下只会有最后一条未解决，但不排除多步崩溃的场景）
      }
    }
    return null;
  }

}
