// @vico/agent - AgentLoop core engine: drives the model→tool→repeat loop for a single turn
import type {RunTurnOptions, Step, TurnEvent, TurnResult, TurnSession} from './types.js';
import type {ToolCall, ToolExecutionContext, ToolResult} from '../tool/types.js';
import {toToolDescriptor} from '../tool/create-tool.js';
import {TurnOutput} from './turn-output.js';
import type {Agent} from './agent.js';
import type {ModelMessage, ModelRequest, ModelStreamChunk} from '../model/types.js';
import {ToolBroker} from '../tool/tool-broker.js';
import type {TurnTracer, TurnTraceSession} from '../observable/turn-tracer.js';
import {ContextCompactor} from './context-compactor.js';
import type {TokenEconomy} from './token-economy.js';
import type {ApprovalGate} from './approval-gate.js';
import type {ContextProcessor} from './context-processors/context-processor.js';
import {ModelRequestContext, ProcessorPipeline} from './context-processors/context-processor.js';

/** executeModelStep 的返回值 */
interface ModelStepResult {
  /** 是否终止循环 */
  shouldBreak: boolean;
  /** 本 step 的 token 用量 */
  usage: { input: number; output: number };
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

/** AgentLoop 构造选项 */
export interface AgentLoopOptions {
  agent: Agent;
  processors?: ContextProcessor[];
  compactor?: ContextCompactor;
  tokenEconomy?: TokenEconomy;
}

/** executeModelStep / callModel 共享上下文 */
interface StepSharedContext {
  ctx: ModelRequestContext
  session: TurnSession;
  traceSession: TurnTraceSession;
  toolApprovalState: Map<string, boolean>;
}

/** AgentLoop — 编排 model→tool→repeat 循环 */
export class AgentLoop {
  private agent: Agent;
  private toolBroker: ToolBroker;
  private compactor?: ContextCompactor;
  private tokenEconomy?: TokenEconomy;
  private approvalGate?: ApprovalGate;
  private tracer: TurnTracer;
  private pipeline: ProcessorPipeline;

  constructor(options: AgentLoopOptions) {
    this.agent = options.agent;
    this.toolBroker = new ToolBroker(options.agent.tools);
    this.compactor = options.compactor;
    this.tokenEconomy = options.tokenEconomy;
    this.tracer = options.agent.tracer;
    this.approvalGate = options.agent.approvalGate;
    this.pipeline = new ProcessorPipeline(options.processors ?? []);
  }

  /**
   * 执行一个 turn，同步返回 TurnOutput（含 ReadableStream 流和 result Promise）。
   * 历史消息由 Memory 自动补充。外部通过 TurnOutput.abort() 终止。
   *
   * @param threadId - 会话线程 ID
   * @param userMessage - 用户消息
   * @param opts - turn 运行可选参数
   * @returns TurnOutput 实例，包含输出流和结果 Promise
   */
  runTurn(
    threadId: string,
    userMessage: ModelMessage,
    opts?: RunTurnOptions,
  ): TurnOutput {
    let resolveResult!: (result: TurnResult) => void;
    let rejectResult!: (err: Error) => void;
    const resultPromise = new Promise<TurnResult>((resolve, reject) => {
      resolveResult = resolve;
      rejectResult = reject;
    });

    const internalAc = new AbortController();
    const interrupted = { value: false };

    const abort = () => {
      interrupted.value = true;
      internalAc.abort();
    };

    const stream = new ReadableStream<ModelStreamChunk>({
      start: async (controller) => {
        try {
          const result = await this.run({
            threadId, userMessage, signal: internalAc.signal,
            controller, opts, interrupted,
          });
          resolveResult(result);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          this.emit({ type: 'error', message: msg });
          rejectResult(err instanceof Error ? err : new Error(msg));
        } finally {
          try { controller.close(); } catch { /* already closed */ }
        }
      },
    });

    return new TurnOutput(stream, resultPromise, abort);
  }

  /**
   * runTurn 的核心逻辑，由 ReadableStream 的 start 回调调用。
   *
   * @param ctx - 运行上下文
   * @param ctx.threadId - 会话线程 ID
   * @param ctx.userMessage - 用户消息
   * @param ctx.signal - 中断信号
   * @param ctx.controller - 流控制器
   * @param ctx.opts - turn 运行可选参数
   * @param ctx.interrupted - 中断状态标记
   * @returns turn 最终结果
   */
  private async run(ctx: {
    threadId: string;
    userMessage: ModelMessage;
    signal: AbortSignal;
    controller: ReadableStreamDefaultController<ModelStreamChunk>;
    opts?: RunTurnOptions;
    interrupted: { value: boolean };
  }): Promise<TurnResult> {
    const { threadId, userMessage, signal, controller, opts, interrupted } = ctx;
    // 历史消息由 MemoryProcessor 在 pipeline 中注入，这里只放当前用户消息
    let steps = 0;
    const usage = { input: 0, output: 0 };
    const scopeId = opts?.scopeId ?? '';
    const userId = opts?.userId ?? '';
    const workspace = opts?.workspace ?? '';

    // 确保 threadStore 中的 thread 和 turn 存在
    const threadStore = this.agent.thread;
    let thread = await threadStore.getThread(threadId);
    if (!thread) {
      const title = userMessage.content.slice(0, 50);
      thread = await threadStore.createThread(this.agent.id, title, threadId, { userId: userId || undefined });
    }
    const turn = await threadStore.createTurn(threadId);

    const session: TurnSession = { workspace, thread, turn };

    const traceSession = this.tracer.startTurn(thread, userMessage);
    const turnSpan = traceSession.startSpan('agent_run');
    const toolApprovalState = new Map<string, boolean>();

    // 运行 pipeline 一次，提取不变的上下文前缀/后缀
    const requestContext = new ModelRequestContext({
      agent: this.agent,
      userMessage,
      tools: [...this.agent.tools],
      thread,
      scopeId,
    });
    await this.pipeline.enter(requestContext);

    // 记录用户消息
    await threadStore.appendEntry({
      threadId,
      turnId: turn.id,
      role: userMessage.role,
      content: userMessage.content,
    });

    // 首轮消息包含（历史消息+当前消息）
    const messages: ModelMessage[] = [...requestContext.messages];

    try {
      while (steps < this.agent.maxSteps && !interrupted.value) {
        if (signal.aborted) {
          await threadStore.updateTurn(turn.id, { status: 'aborted', steps });
          turnSpan.end({ status: 'aborted' });
          const abortResult: TurnResult = {
            status: 'aborted', steps, usage, messages,
          };

          await this.tracer.finish(traceSession, abortResult);
          return abortResult;
        }

        const step: Step = { index: steps, threadId, scopeId, signal };
        const { shouldBreak, usage: stepUsage } = await this.executeModelStep(step, messages, controller, {
          ctx: requestContext,
          session,
          traceSession,
          toolApprovalState,
        });
        usage.input += stepUsage.input;
        usage.output += stepUsage.output;

        if (shouldBreak) break;
        steps++;
      }

      // 轮次结束后触发 processor 流水线
      await this.pipeline.leave(requestContext);

      const finalStatus = interrupted.value ? 'aborted' : 'completed';
      await threadStore.updateTurn(turn.id, { status: finalStatus, steps });

      turnSpan.end({ status: 'completed', steps });
      this.emit({ type: 'done', usage });

      const finalResult: TurnResult = {
        status: interrupted.value ? 'interrupted' : 'completed',
        steps,
        usage,
        messages,
      };
      await this.tracer.finish(traceSession, finalResult);
      return finalResult;
    } catch (err) {
      await threadStore.updateTurn(turn.id, { status: 'failed', steps });
      turnSpan.error(err as Error);
      const failResult: TurnResult = {
        status: 'failed', steps, usage, messages,
      };
      await this.tracer.finish(traceSession, failResult);
      throw err;
    }
  }

  /**
   * 执行一个 model step：压缩 → model 调用 → 审批 → 工具执行 → 持久化。
   *
   * @param step - 当前 step 信息
   * @param messages - 消息列表（会被原地修改）
   * @param controller - 流控制器
   * @param shared - 共享上下文
   * @param shared.ctx - 模型请求上下文
   * @param shared.session - turn 会话
   * @param shared.traceSession - 链路追踪会话
   * @param shared.toolApprovalState - 工具审批状态缓存
   * @returns 是否终止循环及 token 用量
   */
  private async executeModelStep(
    step: Step,
    messages: ModelMessage[],
    controller: ReadableStreamDefaultController<ModelStreamChunk>,
    shared: StepSharedContext,
  ): Promise<ModelStepResult> {
    this.emit({ type: 'step-start', step: step.index + 1 });

    const usage = { input: 0, output: 0 };

    await this.tryCompact(messages, step.signal);

    if (this.tokenEconomy?.isInputExhausted()) {
      this.emit({ type: 'error', message: '输入 token 预算已耗尽' });
      return { shouldBreak: true, usage };
    }

    const modelResult = await this.callModel(messages, step, controller, shared);

    usage.input += modelResult.usage.input;
    usage.output += modelResult.usage.output;
    this.tokenEconomy?.track(modelResult.usage.input, modelResult.usage.output);

    if (modelResult.text || modelResult.toolCalls.length > 0) {
      messages.push({ role: 'assistant', content: modelResult.text, ...(modelResult.toolCalls.length > 0 && { toolCalls: modelResult.toolCalls }) });
    }

    // 持久化 assistant 消息
    const last = messages.at(-1);
    if (last?.role === 'assistant') {
      await this.agent.thread.appendEntry({
        threadId: shared.session.thread.id,
        turnId: shared.session.turn.id,
        role: last.role,
        content: last.content,
        toolCalls: last.toolCalls,
      });
    }

    if (modelResult.toolCalls.length === 0) {
      this.emit({ type: 'step-end', step: step.index + 1 });
      return { shouldBreak: true, usage };
    }

    // 审批 + 执行 + 持久化
    const { approvedCalls, deniedResults } = await this.resolveToolApprovals(
      modelResult.toolCalls, controller, shared,
    );

    const toolResults: ToolResult[] = [];
    if (approvedCalls.length > 0) {
      toolResults.push(...await this.executeToolCalls(approvedCalls, shared.session, step, shared.traceSession));
    }
    toolResults.push(...deniedResults);

    await this.appendToolResults(toolResults, messages, shared);

    this.emit({ type: 'step-end', step: step.index + 1 });
    return { shouldBreak: false, usage };
  }

  /**
   * 解析工具审批：遍历 toolCalls，按策略分类为 approvedCalls / deniedResults。
   *
   * @param toolCalls - 模型返回的工具调用
   * @param controller - 流控制器
   * @param shared - 共享上下文
   * @returns 审批通过和拒绝的分类结果
   */
  private async resolveToolApprovals(
    toolCalls: ToolCall[],
    controller: ReadableStreamDefaultController<ModelStreamChunk>,
    shared: StepSharedContext,
  ): Promise<{ approvedCalls: ToolCall[]; deniedResults: ToolResult[] }> {
    const approvedCalls: ToolCall[] = [];
    const deniedResults: ToolResult[] = [];

    for (const call of toolCalls) {
      const tool = this.toolBroker.findTool(call.name);
      const policy = tool?.policy ?? 'auto';

      if (policy === 'never') {
        deniedResults.push({ callId: call.id, name: call.name, status: 'error', output: null, error: '被策略阻止' });
        continue;
      }

      if (policy === 'auto' || policy === 'suggest') {
        approvedCalls.push(call);
        continue;
      }

      // on-request: 首次使用需审批
      const isFirstUse = !shared.toolApprovalState.has(call.name);
      const wasApproved = shared.toolApprovalState.get(call.name) ?? false;
      if (!isFirstUse && wasApproved) {
        approvedCalls.push(call);
        continue;
      }

      if (!this.approvalGate) {
        shared.toolApprovalState.set(call.name, true);
        approvedCalls.push(call);
        continue;
      }

      const approvalId = crypto.randomUUID();
      controller.enqueue({
        type: 'tool-approval-request',
        approvalId,
        toolCallId: call.id,
        toolName: call.name,
        input: call.args,
      });

      const { decision } = this.approvalGate.requestApproval(call, undefined, approvalId);
      const result = await decision;

      if (result.approved) {
        shared.toolApprovalState.set(call.name, true);
        approvedCalls.push(call);
      } else {
        controller.enqueue({
          type: 'tool-output-denied',
          toolCallId: call.id,
          toolName: call.name,
          reason: result.reason,
        });
        deniedResults.push({
          callId: call.id, name: call.name,
          status: 'error', output: null,
          error: result.reason ?? '用户拒绝',
        });
      }
    }

    return { approvedCalls, deniedResults };
  }

  /**
   * 将工具结果追加到 messages 并持久化到 threadStore。
   *
   * @param toolResults - 工具执行结果
   * @param messages - 消息列表（会被原地修改）
   * @param shared - 共享上下文
   */
  private async appendToolResults(
    toolResults: ToolResult[],
    messages: ModelMessage[],
    shared: StepSharedContext,
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
   *
   * @param event - turn 事件
   */
  private emit = (event: TurnEvent): void => {
    this.agent.events.emit(event);
  };

  /**
   * 压缩检查，按需原地替换 messages。
   *
   * @param messages - 消息列表（会被原地修改）
   * @param signal - 中断信号
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
    shared: StepSharedContext,
  ): Promise<CallModelResult> {
    const { ctx, traceSession } = shared;
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

          case 'finish':
            controller.enqueue(chunk);
            if (chunk.usage) {
              modelUsage.input = chunk.usage.inputTokens.total ?? 0;
              modelUsage.output = chunk.usage.outputTokens.total ?? 0;
            }
            break;

          case 'error':
            controller.enqueue(chunk);
            const errMsg = chunk.error instanceof Error ? chunk.error.message : String(chunk.error);
            modelSpan?.error(new Error(errMsg));
            this.emit({ type: 'error', message: errMsg });
            break;

          // stream-start/response-metadata/raw：内部使用
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      modelSpan?.error(new Error(msg));
      this.emit({ type: 'error', message: msg });
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
   *
   * @param toolCalls - 工具调用列表
   * @param session - turn 会话
   * @param step - 当前 step 信息
   * @param traceSession - 链路追踪会话
   * @returns 工具执行结果数组
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
      awaitApproval: async (call: ToolCall) => {
        if (this.approvalGate) {
          const { decision } = this.approvalGate.requestApproval(call);
          return decision;
        }
        return { approved: true };
      },
      signal: step.signal,
    };

    return this.toolBroker.executeBatch(calls, context);
  }

}
