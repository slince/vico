// @vico/agent - AgentLoop core engine: drives the model→tool→repeat loop for a single turn
import type {RunTurnOptions, Step, ToolCallSession, TurnEvent, TurnResult, TurnStreamChunk} from './types.js';
import {TurnOutput} from './turn-output.js';
import type {Agent} from './agent.js';
import type {ModelMessage} from '../model/types.js';
import type {ToolBroker} from '../tool/tool-broker.js';
import type {ToolCall, ToolExecutionContext, ToolResult} from '../tool/types.js';
import type {EventPayload, EventRecorder} from '../events/types.js';
import type {SpanTracker} from '../observable/types.js';
import {ContextCompactor} from './context-compactor.js';
import type {TokenEconomy} from './token-economy.js';
import type {ApprovalGate} from './approval-gate.js';
import type {ContextProcessor} from '../prompt/context-processor.js';
import {buildModelRequest, ModelRequestContext, ProcessorPipeline} from '../prompt/context-processor.js';
import type {WorkingMemory} from '../memory/types.js';
import {DynamicInstructionProcessor} from './dynamic-instruction-processor.js';

/** TurnEvent → TurnStreamChunk 映射：仅 stream 消费端需要的事件 */
function eventToChunk(event: TurnEvent): TurnStreamChunk | undefined {
  switch (event.type) {
    case 'text-delta':
      return { type: 'text-delta', content: event.content };
    case 'reasoning-delta':
      return { type: 'reasoning-delta', content: event.content };
    case 'tool-call-start':
      return { type: 'tool-call', id: event.id, name: event.name, args: event.args };
    case 'tool-result':
      return { type: 'tool-result', id: event.id, name: event.name, status: event.status, output: event.output };
    case 'step-end':
      return { type: 'step-end' };
    case 'compacted':
      return { type: 'compacted', removedTokens: event.removedTokens };
    case 'error':
      return { type: 'error', message: event.message };
    default:
      return undefined;
  }
}

/** callModel 的返回值 */
interface CallModelResult {
  /** 模型生成的完整文本 */
  text: string;
  /** 模型请求的工具调用 */
  toolCalls: ToolCall[];
  /** 本次调用的 token 用量 */
  usage: { input: number; output: number };
  /** 错误信息（如有） */
  error?: string;
}

/** AgentLoop 构造选项 */
export interface AgentLoopOptions {
  agent: Agent;
  toolBroker: ToolBroker;
  processors?: ContextProcessor[];
  compactor?: ContextCompactor;
  tokenEconomy?: TokenEconomy;
  approvalGate?: ApprovalGate;
  events: EventRecorder<TurnEvent>;
  spanTracker: SpanTracker;
  workingMemory?: WorkingMemory;
}

/** AgentLoop — 编排 model→tool→repeat 循环 */
export class AgentLoop {
  private agent: Agent;
  private toolBroker: ToolBroker;
  private compactor?: ContextCompactor;
  private tokenEconomy?: TokenEconomy;
  private approvalGate?: ApprovalGate;
  private events: EventRecorder<TurnEvent>;
  private spanTracker: SpanTracker;
  private steerBuffer: string[] = [];
  private interrupted = false;

  private pipeline: ProcessorPipeline;

  constructor(options: AgentLoopOptions) {
    this.agent = options.agent;
    this.toolBroker = options.toolBroker;
    this.compactor = options.compactor;
    this.tokenEconomy = options.tokenEconomy;
    this.approvalGate = options.approvalGate;
    this.events = options.events;
    this.spanTracker = options.spanTracker;

    // 用户提供的处理器 + 内置 DynamicInstructionProcessor
    const userProcessors = options.processors ?? [];
    const steerProcessor = new DynamicInstructionProcessor(() => {
      const text = this.drainSteerBuffer();
      return text ? [text] : [];
    });
    this.pipeline = new ProcessorPipeline([...userProcessors, steerProcessor]);
  }

  /** 执行一个 turn，同步返回 TurnOutput（含 ReadableStream 流和 result Promise） */
  runTurn(
    threadId: string,
    history: ModelMessage[],
    userMessage: ModelMessage,
    signal: AbortSignal,
    opts?: RunTurnOptions,
  ): TurnOutput {
    let resolveResult!: (result: TurnResult) => void;
    let rejectResult!: (err: Error) => void;
    const resultPromise = new Promise<TurnResult>((resolve, reject) => {
      resolveResult = resolve;
      rejectResult = reject;
    });

    // 创建内部 AbortController，供 TurnOutput.abort() 调用
    const internalAc = new AbortController();
    const combinedSignal = signal;

    const abort = () => {
      this.interrupt();
      internalAc.abort();
    };

    const stream = new ReadableStream<TurnStreamChunk>({
      start: async (controller) => {
        try {
          const result = await this._run({
            threadId, history, userMessage, signal: combinedSignal,
            controller, opts,
          });
          resolveResult(result);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          this.emit({ type: 'error', message: msg });
          controller.enqueue({ type: 'error', message: msg });
          rejectResult(err instanceof Error ? err : new Error(msg));
        } finally {
          try { controller.close(); } catch { /* already closed */ }
        }
      },
    });

    // 监听外部 signal
    if (signal.aborted) {
      abort();
    }
    signal.addEventListener('abort', abort, { once: true });

    return new TurnOutput(stream, resultPromise, abort);
  }

  /** runTurn 的核心逻辑，由 ReadableStream 的 start 回调调用 */
  private async _run(ctx: {
    threadId: string;
    history: ModelMessage[];
    userMessage: ModelMessage;
    signal: AbortSignal;
    controller: ReadableStreamDefaultController<TurnStreamChunk>;
    opts?: RunTurnOptions;
  }): Promise<TurnResult> {
    const { threadId, history, userMessage, signal, controller, opts } = ctx;
    const turnSpan = this.spanTracker.startSpan('agent_run');
    this.interrupted = false;

    const messages = [...history, userMessage];
    let steps = 0;
    const usage = { input: 0, output: 0 };
    const scopeId = opts?.scopeId ?? '';
    const userId = opts?.userId ?? '';
    const workspace = opts?.workspace ?? '';

    // emit + enqueue 到 stream
    const fire = (event: TurnEvent) => {
      this.emit(event);
      const chunk = eventToChunk(event);
      if (chunk) controller.enqueue(chunk);
    };

    // 确保 threadStore 中的 thread 和 turn 存在
    const threadStore = this.agent.thread;
    let thread = await threadStore.getThread(threadId);
    if (!thread) {
      const title = userMessage.content.slice(0, 50);
      thread = await threadStore.createThread(this.agent.config.id, title, threadId, { userId: userId || undefined });
    }
    const turn = await threadStore.createTurn(threadId);

    const session: ToolCallSession = { workspace, thread, turn };

    // 记录用户消息
    if (threadStore && turn) {
      await threadStore.appendEntry({
        threadId,
        turnId: turn.id,
        role: userMessage.role,
        content: userMessage.content,
      });
    }

    try {
      this.applySteerBuffer(messages);

      while (steps < this.agent.config.maxSteps && !this.interrupted) {
        if (signal.aborted) {
          if (threadStore && turn) {
            await threadStore.updateTurn(turn.id, { status: 'aborted', steps });
          }
          turnSpan.end({ status: 'aborted' });
          return { status: 'aborted', steps, usage, messages };
        }

        const step: Step = { index: steps, threadId, scopeId, signal, fire };

        fire({ type: 'step-start', step: step.index + 1 });

        await this.tryCompact(messages, signal, fire);

        if (this.tokenEconomy?.isInputExhausted()) {
          fire({ type: 'error', message: 'Input token budget exhausted' });
          break;
        }

        const modelResult = await this.callModel(messages, step);

        // 从返回值应用副作用，不修改 callModel 的入参
        usage.input += modelResult.usage.input;
        usage.output += modelResult.usage.output;
        this.tokenEconomy?.track(modelResult.usage.input, modelResult.usage.output);

        if (modelResult.text || modelResult.toolCalls.length > 0) {
          messages.push({ role: 'assistant', content: modelResult.text, ...(modelResult.toolCalls.length > 0 && { toolCalls: modelResult.toolCalls }) });
        }

        // 记录 assistant 消息到 threadStore
        const assistantMsg = messages.at(-1);
        if (threadStore && turn && assistantMsg?.role === 'assistant') {
          await threadStore.appendEntry({
            threadId,
            turnId: turn.id,
            role: assistantMsg.role,
            content: assistantMsg.content,
            toolCalls: assistantMsg.toolCalls,
          });
        }

        if (modelResult.toolCalls.length === 0) {
          fire({ type: 'step-end', step: steps + 1 });
          break;
        }

        await this.executeToolCalls(modelResult.toolCalls, messages, session, step);

        // 记录 tool 消息到 threadStore
        if (threadStore && turn) {
          for (const msg of messages.slice(-modelResult.toolCalls.length)) {
            if (msg.role === 'tool') {
              await threadStore.appendEntry({
                threadId,
                turnId: turn.id,
                role: msg.role,
                content: msg.content,
                toolCallId: msg.toolCallId,
              });
            }
          }
        }

        fire({ type: 'step-end', step: steps + 1 });
        steps++;
      }

      await this.pipeline.resolve(
        new ModelRequestContext({
          agent: this.agent.config,
          messages: [...messages],
          tools: [...this.agent.tools],
          threadId,
          scopeId,
        }),
      );

      if (threadStore && turn) {
        const finalStatus = this.interrupted ? 'aborted' : 'completed';
        await threadStore.updateTurn(turn.id, { status: finalStatus, steps });
      }

      turnSpan.end({ status: 'completed', steps });
      this.emit({ type: 'done', usage });

      return {
        status: this.interrupted ? 'interrupted' : 'completed',
        steps,
        usage,
        messages,
      };
    } catch (err) {
      if (threadStore && turn) {
        await threadStore.updateTurn(turn.id, { status: 'failed', steps });
      }
      turnSpan.error(err as Error);
      throw err;
    }
  }

  /** emit 事件到订阅者 */
  private emit(event: TurnEvent): void {
    this.events.emit(event);
  }

  /** 订阅 turn 事件 */
  on<K extends string>(event: K, handler: (data: EventPayload<TurnEvent, K>) => void): void {
    this.events.on(event, handler);
  }

  /** 取消订阅 turn 事件 */
  off<K extends string>(event: K, handler: (data: EventPayload<TurnEvent, K>) => void): void {
    this.events.off(event, handler);
  }

  /** 排干 steer 缓冲区并追加到消息列表 */
  private applySteerBuffer(messages: ModelMessage[]): void {
    const text = this.drainSteerBuffer();
    if (text) {
      messages.push({ role: 'user', content: text });
    }
  }

  /** 压缩检查 */
  private async tryCompact(
    messages: ModelMessage[],
    signal: AbortSignal,
    fire: (e: TurnEvent) => void,
  ): Promise<void> {
    if (!this.compactor) return;
    const result = await this.compactor.compactIfNeeded(messages, this.agent.modelClient, signal);
    if (result.wasCompacted) {
      messages.length = 0;
      messages.push(...result.compacted);
      fire({ type: 'compacted', removedTokens: result.removedTokens });
    }
  }

  /** 单次模型调用。仅从 messages 读取上下文，不修改入参，结果通过 CallModelResult 返回 */
  private async callModel(
    messages: ModelMessage[],
    step: Step,
  ): Promise<CallModelResult> {
    const modelUsage = { input: 0, output: 0 };

    const ctx = new ModelRequestContext({
      agent: this.agent.config,
      messages: [...messages],
      tools: [...this.agent.tools],
      threadId: step.threadId,
      scopeId: step.scopeId,
    });
    await this.pipeline.run(ctx);
    const request = buildModelRequest(ctx);

    let fullText = '';
    const toolCalls: ToolCall[] = [];
    const modelSpan = this.spanTracker.startSpan('model_step', { step: step.index + 1 });

    const { stream } = await this.agent.modelClient.stream({
      system: request.system,
      messages: request.messages,
      tools: request.tools,
      maxOutputTokens: request.maxTokens,
      temperature: request.temperature,
      abortSignal: step.signal,
    });

    try {
      for await (const chunk of stream) {
        switch (chunk.type) {
          case 'text-delta':
            fullText += chunk.delta;
            step.fire({ type: 'text-delta', content: chunk.delta });
            break;
          case 'reasoning-delta':
            step.fire({ type: 'reasoning-delta', content: chunk.delta });
            break;
          case 'tool-call':
            toolCalls.push({ id: chunk.toolCallId, name: chunk.toolName, args: (chunk.input ?? {}) as Record<string, unknown> });
            step.fire({ type: 'tool-call-start', id: chunk.toolCallId, name: chunk.toolName, args: (chunk.input ?? {}) as Record<string, unknown> });
            break;
          case 'finish':
            if (chunk.usage) {
              modelUsage.input = chunk.usage.inputTokens.total ?? 0;
              modelUsage.output = chunk.usage.outputTokens.total ?? 0;
            }
            break;
          case 'error':
            const errMsg = chunk.error instanceof Error ? chunk.error.message : String(chunk.error);
            modelSpan.error(new Error(errMsg));
            step.fire({ type: 'error', message: errMsg });
            break;
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      modelSpan.error(new Error(msg));
      step.fire({ type: 'error', message: msg });
      return { text: fullText, toolCalls, usage: modelUsage, error: msg };
    }

    modelSpan.end({ textLength: fullText.length, toolCalls: toolCalls.length });

    return { text: fullText, toolCalls, usage: modelUsage };
  }

  /** 执行工具调用并将结果追加到 messages */
  private async executeToolCalls(
    toolCalls: ToolCall[],
    messages: ModelMessage[],
    session: ToolCallSession,
    step: Step,
  ): Promise<void> {
    const toolSpan = this.spanTracker.startSpan('tool_call', { count: toolCalls.length });
    let results: ToolResult[];
    try {
      results = await this.dispatchTools(toolCalls, session, step);
      toolSpan.end({ results: results.length });
    } catch (err) {
      toolSpan.error(err as Error);
      throw err;
    }

    for (const r of results) {
      const raw = r.status === 'success' ? JSON.stringify(r.output) : '';
      const truncated = this.tokenEconomy?.truncateToolOutput(raw) ?? raw;
      messages.push({ role: 'tool', content: truncated, toolCallId: r.callId });
      step.fire({
        type: 'tool-result',
        id: r.callId,
        name: r.name,
        status: r.status,
        output: r.output,
      });
    }
  }

  private async dispatchTools(calls: ToolCall[], session: ToolCallSession, step: Step): Promise<ToolResult[]> {
    const context: ToolExecutionContext = {
      session,
      agentId: this.agent.config.id,
      awaitApproval: async (call: ToolCall) => {
        if (this.approvalGate) {
          return this.approvalGate.requestApproval(call);
        }
        return { approved: true };
      },
      signal: step.signal,
    };

    return this.toolBroker.executeBatch(calls, context);
  }

  /** 排干 steer 缓冲区 */
  private drainSteerBuffer(): string {
    const text = this.steerBuffer.join('\n');
    this.steerBuffer = [];
    return text;
  }

  interrupt(): void {
    this.interrupted = true;
  }

  steer(text: string): void {
    this.steerBuffer.push(text);
  }
}

/** 消费 TurnOutput 并返回最终结果（丢弃流数据） */
export async function collectTurnResult(
  output: TurnOutput,
): Promise<TurnResult> {
  return output.result;
}
