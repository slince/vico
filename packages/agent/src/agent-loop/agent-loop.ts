// @vico/agent - AgentLoop core engine: drives the model→tool→repeat loop for a single turn
import type {RunTurnOptions, Step, ToolCallSession, TurnEvent, TurnResult} from './types.js';
import {TurnOutput} from './turn-output.js';
import type {Agent} from './agent.js';
import type {ModelMessage, ModelStreamChunk} from '../model/types.js';
import type {Thread} from '../thread/types.js';
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

  /** 执行一个 turn，同步返回 TurnOutput（含 ReadableStream 流和 result Promise）。历史消息由 Memory 自动补充。外部通过 TurnOutput.abort() 终止 */
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

    const abort = () => {
      this.interrupt();
      internalAc.abort();
    };

    const stream = new ReadableStream<ModelStreamChunk>({
      start: async (controller) => {
        try {
          const result = await this._run({
            threadId, userMessage, signal: internalAc.signal,
            controller, opts,
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

  /** runTurn 的核心逻辑，由 ReadableStream 的 start 回调调用 */
  private async _run(ctx: {
    threadId: string;
    userMessage: ModelMessage;
    signal: AbortSignal;
    controller: ReadableStreamDefaultController<ModelStreamChunk>;
    opts?: RunTurnOptions;
  }): Promise<TurnResult> {
    const { threadId, userMessage, signal, controller, opts } = ctx;
    const turnSpan = this.spanTracker.startSpan('agent_run');
    this.interrupted = false;

    // 历史消息由 MemoryProcessor 在 pipeline 中注入，这里只放当前用户消息
    const messages: ModelMessage[] = [userMessage];
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

        const step: Step = { index: steps, threadId, scopeId, signal };

        this.emit({ type: 'step-start', step: step.index + 1 });

        await this.tryCompact(messages, signal);

        if (this.tokenEconomy?.isInputExhausted()) {
          this.emit({ type: 'error', message: 'Input token budget exhausted' });
          break;
        }

        const modelResult = await this.callModel(messages, thread, step, controller);

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
          this.emit({ type: 'step-end', step: steps + 1 });
          break;
        }

        const toolResults = await this.executeToolCalls(modelResult.toolCalls, session, step);

        // 追加 tool 消息
        for (const r of toolResults) {
          const raw = r.status === 'success' ? JSON.stringify(r.output) : '';
          const truncated = this.tokenEconomy?.truncateToolOutput(raw) ?? raw;
          messages.push({ role: 'tool', content: truncated, toolCallId: r.callId });
        }

        // 记录 tool 消息到 threadStore
        if (threadStore && turn) {
          for (const r of toolResults) {
            const raw = r.status === 'success' ? JSON.stringify(r.output) : '';
            const truncated = this.tokenEconomy?.truncateToolOutput(raw) ?? raw;
            await threadStore.appendEntry({
              threadId,
              turnId: turn.id,
              role: 'tool',
              content: truncated,
              toolCallId: r.callId,
            });
          }
        }

        this.emit({ type: 'step-end', step: steps + 1 });
        steps++;
      }

      await this.pipeline.resolve(
        new ModelRequestContext({
          agent: this.agent.config,
          messages: [...messages],
          tools: [...this.agent.tools],
          thread,
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

  /** emit 事件到订阅者（箭头函数绑定 this，可直接作为回调传递） */
  private emit = (event: TurnEvent): void => {
    this.events.emit(event);
  };

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

  /** 压缩检查，按需原地替换 messages */
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

  /** 单次模型调用。仅从 messages 读取上下文，不修改入参，结果通过 CallModelResult 返回。模型 chunk 直接 enqueue 到 stream */
  private async callModel(
    messages: ModelMessage[],
    thread: Thread,
    step: Step,
    controller: ReadableStreamDefaultController<ModelStreamChunk>,
  ): Promise<CallModelResult> {
    const modelUsage = { input: 0, output: 0 };

    const ctx = new ModelRequestContext({
      agent: this.agent.config,
      messages: [...messages],
      tools: [...this.agent.tools],
      thread,
      step,
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
            modelSpan.error(new Error(errMsg));
            this.emit({ type: 'error', message: errMsg });
            break;

          // stream-start/response-metadata/raw/tool-approval-request：内部使用
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      modelSpan.error(new Error(msg));
      this.emit({ type: 'error', message: msg });
      return { text: fullText, toolCalls, usage: modelUsage, error: msg };
    }

    modelSpan.end({ textLength: fullText.length, toolCalls: toolCalls.length });

    return { text: fullText, toolCalls, usage: modelUsage };
  }

  /** 执行工具调用，返回结果数组。不修改入参，事件通过 fire 触发 */
  private async executeToolCalls(
    toolCalls: ToolCall[],
    session: ToolCallSession,
    step: Step,
  ): Promise<ToolResult[]> {
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
