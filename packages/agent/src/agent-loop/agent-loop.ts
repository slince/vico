// @vico/agent - AgentLoop core engine: drives the model→tool→repeat loop for a single turn
import type {PauseInfo, RunTurnOptions, Step, TurnEvent, TurnResult, TurnSession} from './types.js';
import type {ApprovalResolver, ToolCall, ToolExecutionContext, ToolResult} from '../tool/types.js';
import type {Thread, ThreadContext, Turn} from '../thread/types.js';
import {toToolDescriptor} from '../tool/create-tool.js';
import {resolvePolicy} from '../tool/utils.js';
import {TurnOutput} from './turn-output.js';
import type {Agent} from './agent.js';
import type {ModelMessage, ModelRequest, ModelStreamChunk} from '../model/types.js';
import {ToolBroker} from '../tool/tool-broker.js';
import type {TurnTracer, TurnTraceSession} from '../observable/turn-tracer.js';
import {ContextCompactor} from './context-compactor.js';
import type {TokenEconomy} from './token-economy.js';
import type {ContextProcessor} from './context-processors/context-processor.js';
import {ModelRequestContext, ProcessorPipeline} from './context-processors/context-processor.js';

/** executeModelStep 的返回值 */
export interface ModelStepResult {
  /** 是否终止循环 */
  shouldBreak: boolean;
  /** 是否需要暂停等待外部审批 */
  shouldPause: boolean;
  /** 暂停信息（shouldPause 为 true 时需要） */
  pauseInfo?: PauseInfo;
  /** 本 step 的 token 用量 */
  usage: { input: number; output: number };
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
  usage: { input: number; output: number };
  /** 错误信息（如有） */
  error?: string | Error;
}

/** executeModelStep / callModel 共享上下文 */
export interface StepContext {
  ctx: ModelRequestContext
  session: TurnSession;
  traceSession: TurnTraceSession;
  toolApprovalState: Map<string, boolean>;
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
  runTurn(userMessage: ModelMessage, options?: RunTurnOptions): TurnOutput {
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
          const result = await this.startLoop({
            userMessage, signal: internalAc.signal,
            controller, options,
          });
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
    options?: RunTurnOptions;
  }): Promise<TurnResult> {
    const { userMessage, signal, controller, options } = ctx;
    const threadId = options?.threadId ?? `${this.agent.id}-${Date.now()}`;
    const usage = { input: 0, output: 0 };

    const threadStore = this.agent.thread;

    // 确保 thread 存在
    let thread = await threadStore.getThread(threadId);
    if (!thread) {
      const title = userMessage.content.slice(0, 50);
      thread = await threadStore.createThread(this.agent.id, title, threadId, options as ThreadContext);
    }

    // 检测未完结的 turn，自动恢复执行
    const latestTurn = await threadStore.getLatestTurn(threadId);

    if (latestTurn && latestTurn.status !== 'completed') {
      return this.startResume({thread, turn: latestTurn, signal, controller, options, usage});
    }

    // ── 正常新 turn ──
    const turn = await threadStore.createTurn(threadId);
    const session: TurnSession = { ...options, thread, turn };

    const traceSession = this.tracer.startTurn(thread, userMessage);
    const turnSpan = traceSession.startSpan('agent_run');
    const toolApprovalState = new Map<string, boolean>();

    const requestContext = new ModelRequestContext({
      agent: this.agent,
      userMessage,
      tools: [...this.agent.tools],
      thread,
      scopeId: options?.scopeId,
    });
    await this.pipeline.enter(requestContext);

    await threadStore.appendEntry({
      threadId,
      turnId: turn.id,
      role: userMessage.role,
      content: userMessage.content,
    });

    const messages: ModelMessage[] = [...requestContext.messages];
    const stepContext: StepContext = { ctx: requestContext, session, traceSession, toolApprovalState };

    return this.executeLoop(messages, 0, controller, stepContext, signal, traceSession, turnSpan, usage);
  }


  /** 从未完结的 turn 恢复执行 */
  private async startResume(params: {
    thread: Thread;
    turn: Turn;
    signal: AbortSignal;
    controller: ReadableStreamDefaultController<ModelStreamChunk>;
    options?: RunTurnOptions;
    usage: { input: number; output: number };
  }): Promise<TurnResult> {
    const { thread, turn, signal, controller, options, usage } = params;
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
    const session: TurnSession = { workspace, thread, turn: turn };
    const traceSession = this.tracer.startTurn(thread, { role: 'user', content: '[resume]' });
    const turnSpan = traceSession.startSpan('agent_resume');
    const toolApprovalState = new Map<string, boolean>();

    const requestContext = new ModelRequestContext({
      agent: this.agent,
      userMessage: { role: 'user', content: '[resume]' },
      tools: [...this.agent.tools],
      thread,
      scopeId,
    });
    await this.pipeline.enter(requestContext);

    const stepContext: StepContext = { ctx: requestContext, session, traceSession, toolApprovalState };

    let startStep = turn.steps;

    // 处理暂停恢复（含审批决策）
    const pauseInfo = turn.metadata as unknown as PauseInfo | undefined;
    if (pauseInfo) {
      if (messages.length !== pauseInfo.messageCount) {
        console.warn(`Message count mismatch: expected ${pauseInfo.messageCount}, got ${messages.length}`);
      }

      if (pauseInfo.reason === 'tool-approval') {
        const decisions = approvalDecisions ?? [];
        const decisionMap = new Map(decisions.map(d => [d.toolCallId, d.approved]));
        const approvedCalls: ToolCall[] = [];
        const deniedResults: ToolResult[] = [];

        for (const pendingCall of pauseInfo.pendingToolCalls) {
          const approved = decisionMap.get(pendingCall.id) ?? false;
          if (approved) {
            approvedCalls.push({ id: pendingCall.id, name: pendingCall.name, args: pendingCall.args as Record<string, unknown> });
          } else {
            deniedResults.push({
              callId: pendingCall.id, name: pendingCall.name,
              status: 'error', output: null,
              error: '被用户拒绝',
            });
          }
        }

        const step: Step = { index: pauseInfo.pausedAtStep, threadId: thread.id, scopeId, signal };
        const toolResults: ToolResult[] = [];
        if (approvedCalls.length > 0) {
          toolResults.push(...await this.executeToolCalls(approvedCalls, session, step, traceSession));
        }
        toolResults.push(...deniedResults);

        await this.appendToolResults(toolResults, messages, stepContext);
      }

      startStep = pauseInfo.pausedAtStep + 1;
    }

    // 恢复 turn 状态为 running
    await threadStore.updateTurn(turn.id, { status: 'running' });

    return this.executeLoop(
      messages, startStep, controller,
      stepContext, signal, traceSession, turnSpan, usage,
    );
  }


  /**
   * 执行 loop 并处理 finalize（pipeline.leave, updateTurn, tracer.finish）。
   */
  private async executeLoop(
    messages: ModelMessage[],
    startStep: number,
    controller: ReadableStreamDefaultController<ModelStreamChunk>,
    stepContext: StepContext,
    signal: AbortSignal,
    traceSession: TurnTraceSession,
    turnSpan: ReturnType<TurnTraceSession['startSpan']>,
    usage: { input: number; output: number },
  ): Promise<TurnResult> {

    const {session: {thread, turn}} = stepContext
    let loopResult: Awaited<ReturnType<typeof this.runStepLoop>> | undefined;

    try {
      loopResult = await this.runStepLoop(messages, startStep, controller, stepContext, signal);
      usage.input += loopResult.usage.input;
      usage.output += loopResult.usage.output;

      // 暂停时跳过正常 finalize
      if (loopResult.finalStatus === 'paused') {
        turnSpan.end({ status: 'paused', steps: loopResult.steps });
        const pausedResult: TurnResult = {
          status: 'paused', steps: loopResult.steps, usage, messages, turnId: turn.id, threadId: thread.id,
        };
        await this.tracer.finish(traceSession, pausedResult);
        return pausedResult;
      }

      await this.pipeline.leave(stepContext.ctx);

      const finalStatus = loopResult.finalStatus === 'aborted' ? 'aborted' : 'completed';
      await this.agent.thread.updateTurn(turn.id, { status: finalStatus, steps: loopResult.steps });

      turnSpan.end({ status: 'completed', steps: loopResult.steps });
      this.emit({ type: 'done', usage });

      const finalResult: TurnResult = {
        status: loopResult.finalStatus === 'aborted'
          ? (signal.aborted ? 'interrupted' : 'aborted')
          : 'completed',
        steps: loopResult.steps,
        usage,
        messages,
        turnId: turn.id,
        threadId: thread.id,
      };
      await this.tracer.finish(traceSession, finalResult);
      return finalResult;
    } catch (err) {
      await this.agent.thread.updateTurn(turn.id, { status: 'failed', steps: loopResult?.steps ?? startStep });
      turnSpan.error(err as Error);
      const failResult: TurnResult = {
        status: 'failed', steps: loopResult?.steps ?? startStep, usage, messages, turnId: turn.id, threadId: thread.id,
      };
      await this.tracer.finish(traceSession, failResult);
      throw err;
    }
  }

  /**
   * 执行 step loop，被 startLoop（新 turn）和 startResume（恢复）共用。
   */
  private async runStepLoop(
    messages: ModelMessage[],
    startStep: number,
    controller: ReadableStreamDefaultController<ModelStreamChunk>,
    stepContext: StepContext,
    signal: AbortSignal,
  ): Promise<{ finalStatus: 'completed' | 'aborted' | 'paused'; steps: number; usage: { input: number; output: number } }> {
    const usage = { input: 0, output: 0 };
    let steps = startStep;

    const {session: {thread, turn}} = stepContext
    while (steps < this.agent.maxSteps && !signal.aborted) {
      const step: Step = { index: steps, threadId: thread.id, scopeId: stepContext.ctx.scopeId, signal };
      const { shouldBreak, shouldPause, pauseInfo, usage: stepUsage } = await this.executeModelStep(step, messages, controller, stepContext);
      usage.input += stepUsage.input;
      usage.output += stepUsage.output;

      if (shouldPause && pauseInfo) {
        // 持久化暂停信息到 turn.metadata
        await this.agent.thread.updateTurn(turn.id, { status: 'paused', steps, metadata: { ...pauseInfo } });
        controller.enqueue({ type: 'turn-paused', reason: pauseInfo.reason, turnId: turn.id });
        return { finalStatus: 'paused', steps, usage };
      }

      if (shouldBreak) break;
      steps++;
    }

    return { finalStatus: signal.aborted ? 'aborted' : 'completed', steps, usage };
  }

  /**
   * 执行一个 model step：压缩 → model 调用 → 审批 → 工具执行 → 持久化。
   */
  private async executeModelStep(
    step: Step,
    messages: ModelMessage[],
    controller: ReadableStreamDefaultController<ModelStreamChunk>,
    stepContext: StepContext,
  ): Promise<ModelStepResult> {
    this.emit({ type: 'step-start', step: step.index + 1 });

    const usage = { input: 0, output: 0 };

    await this.tryCompact(messages, step.signal);

    if (this.tokenEconomy?.isInputExhausted()) {
      this.emit({ type: 'error', error: '输入 token 预算已耗尽' });
      return { shouldBreak: true, shouldPause: false, usage };
    }

    const modelResult = await this.callModel(messages, step, controller, stepContext);

    usage.input += modelResult.usage.input;
    usage.output += modelResult.usage.output;
    this.tokenEconomy?.track(modelResult.usage.input, modelResult.usage.output);

    // 模型输出后的消息处理
    if (modelResult.text || modelResult.toolCalls.length > 0) {
      const assistantMsg = { role: 'assistant' as const, content: modelResult.text, ...(modelResult.toolCalls.length > 0 && { toolCalls: modelResult.toolCalls }) };
      messages.push(assistantMsg);

      await this.agent.thread.appendEntry({
        threadId: stepContext.session.thread.id,
        turnId: stepContext.session.turn.id,
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
    const { approvedCalls, deniedResults, pausedCalls } = await this.resolveToolApprovals(
      modelResult.toolCalls, controller, stepContext,
    );

    // 有待审批的工具 → 暂停 turn
    if (pausedCalls.length > 0) {
      const pendingToolCalls = pausedCalls.map(c => ({ id: c.id, name: c.name, args: c.args }));
      const pauseInfo: PauseInfo = {
        reason: 'tool-approval',
        pendingToolCalls,
        pausedAtStep: step.index,
        messageCount: messages.length,
      };
      this.emit({ type: 'step-end', step: step.index + 1 });
      return { shouldBreak: false, shouldPause: true, pauseInfo, usage };
    }

    const toolResults: ToolResult[] = [];
    if (approvedCalls.length > 0) {
      toolResults.push(...await this.executeToolCalls(approvedCalls, stepContext.session, step, stepContext.traceSession));
    }
    toolResults.push(...deniedResults);

    await this.appendToolResults(toolResults, messages, stepContext);

    this.emit({ type: 'step-end', step: step.index + 1 });
    return { shouldBreak: false, shouldPause: false, usage };
  }

  /**
   * 解析工具审批：遍历 toolCalls，按策略分类为 approvedCalls / deniedResults / pausedCalls。
   */
  private async resolveToolApprovals(
    toolCalls: ToolCall[],
    controller: ReadableStreamDefaultController<ModelStreamChunk>,
    stepContext: StepContext,
  ): Promise<ApprovalClassification> {
    const approvedCalls: ToolCall[] = [];
    const deniedResults: ToolResult[] = [];
    const pausedCalls: ToolCall[] = [];

    for (const call of toolCalls) {
      const tool = this.toolBroker.findTool(call.name);
      const policy = tool?.policy ?? 'auto';

      const isFirstUse = !stepContext.toolApprovalState.has(call.name);
      const wasApproved = stepContext.toolApprovalState.get(call.name) ?? false;

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
        stepContext.toolApprovalState.set(call.name, true);
        approvedCalls.push(call);
        continue;
      }

      // on-request 工具首次使用 → 暂停等待外部审批，不直接拒绝
      if (policy === 'on-request' && isFirstUse && !wasApproved) {
        // use toolCallId as approvalId so the client’s tool-approval-response maps directly
        controller.enqueue({
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
  private async appendToolResults(
    toolResults: ToolResult[],
    messages: ModelMessage[],
    shared: StepContext,
  ): Promise<void> {
    for (const r of toolResults) {
      const raw = r.status === 'success' ? JSON.stringify(r.output) : '';
      const truncated = this.tokenEconomy?.truncateToolOutput(raw) ?? raw;
      messages.push({ role: 'tool', content: truncated, toolCallId: r.callId });
      await this.agent.thread.appendEntry({
        threadId: shared.session.thread.id,
        turnId: shared.session.turn.id,
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
  private async tryCompact(
    messages: ModelMessage[],
    signal: AbortSignal,
  ): Promise<void> {
    if (!this.compactor) return;
    const result = await this.compactor.compactIfNeeded(messages, this.agent.modelClient, signal);
    if (result.wasCompacted) {
      messages.length = 0;
      messages.push(...result.compacted);
      this.emit({ type: 'compacted', removedTokens: result.removedTokens });
    }
  }

  /**
   * 单次模型调用。messages 已由调用方预处理（含 ctx.before/after），
   * 不修改入参，结果通过 CallModelResult 返回。
   */
  private async callModel(
    messages: ReadonlyArray<ModelMessage>,
    step: Step,
    controller: ReadableStreamDefaultController<ModelStreamChunk>,
    stepContext: StepContext,
  ): Promise<CallModelResult> {
    const { ctx, traceSession } = stepContext;
    const modelUsage = { input: 0, output: 0 };

    const request: ModelRequest = {
      system: ctx.systemPrompt,
      messages,
      tools: ctx.tools.map(toToolDescriptor),
      maxOutputTokens: this.agent.maxTokens,
      temperature: this.agent.temperature,
    };

    let fullText = '';
    const toolCalls: ToolCall[] = [];
    const modelSpan = traceSession.startSpan('model_step', { step: step.index + 1 });

    // 记录 LLM 请求参数（原始对象直接传入，tracer 内部提取）
    traceSession.recordModelRequest(step, request);

    console.log("model request", request);

    const { stream } = await this.agent.modelClient.stream({
      ...request,
      abortSignal: step.signal,
    });

    try {
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

          case 'turn-paused':
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
            modelSpan?.error(err instanceof Error ? err : new Error(err));
            this.emit({ type: 'error', error: err });
            break;

          // stream-start/response-metadata/raw：内部使用
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      modelSpan?.error(new Error(msg));
      this.emit({ type: 'error', error: err instanceof Error ? err : String(err) });
      const errorResult: CallModelResult = { text: fullText, toolCalls, usage: modelUsage, error: msg };
      traceSession.recordModelResponse(step, errorResult);
      return errorResult;
    }

    modelSpan?.end({ textLength: fullText.length, toolCalls: toolCalls.length });

    const result: CallModelResult = { text: fullText, toolCalls, usage: modelUsage };
    traceSession.recordModelResponse(step, result);
    return result;
  }

  /**
   * 执行工具调用，返回结果数组。不修改入参，事件通过 emit 触发。
   */
  private async executeToolCalls(
    toolCalls: ToolCall[],
    session: TurnSession,
    step: Step,
    traceSession: TurnTraceSession,
  ): Promise<ToolResult[]> {
    const toolSpan = traceSession.startSpan('tool_call', { count: toolCalls.length });
    const results = await this.dispatchTools(toolCalls, session, step);
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

  private async dispatchTools(calls: ToolCall[], session: TurnSession, step: Step): Promise<ToolResult[]> {
    const context: ToolExecutionContext = {
      session,
      agentId: this.agent.id,
      signal: step.signal,
    };

    return this.toolBroker.executeBatch(calls, context);
  }

}
