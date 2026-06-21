// @vico/agent - AgentLoop core engine: drives the model→tool→repeat loop for a single turn
import type {Agent, AgentLoopOptions, RunTurnOptions, TurnEvent, TurnResult} from './types.js';
import type {ModelMessage} from '../model/types.js';
import type {ToolBroker} from '../tool/tool-broker.js';
import type {ToolCall, ToolExecutionContext, ToolResult} from '../tool/types.js';
import type {EventRecorder, SpanTracker, SSEEvent} from '../observable/types.js';
import {ContextCompactor} from './context-compactor.js';
import type {TokenEconomy} from './token-economy.js';
import type {ApprovalGate} from './approval-gate.js';
import {buildModelRequest, ModelRequestContext, ProcessorPipeline} from '../prompt/context-processor.js';
import {DynamicInstructionProcessor} from './dynamic-instruction-processor.js';


/** AgentLoop — 编排 model→tool→repeat 循环 */
export class AgentLoop {
  private agent: Agent;
  private toolBroker: ToolBroker;
  private compactor?: ContextCompactor;
  private tokenEconomy?: TokenEconomy;
  private approvalGate?: ApprovalGate;
  private events: EventRecorder;
  private spanTracker: SpanTracker;
  private steerBuffer: string[] = [];
  private interrupted = false;
  private currentTurnId = '';

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

  /**
   * 执行一个完整的 turn，流式返回过程详情。
   */
  async *runTurn(
    threadId: string,
    history: ModelMessage[],
    userMessage: ModelMessage,
    signal: AbortSignal,
    opts?: RunTurnOptions,
  ): AsyncGenerator<TurnEvent, TurnResult> {
    const turnSpan = this.spanTracker.startSpan('agent_run');
    this.interrupted = false;

    const messages = [...history, userMessage];
    let steps = 0;
    const usage = { input: 0, output: 0 };
    const scopeId = opts?.scopeId ?? '';
    const toolUserId = opts?.userId ?? '';
    const toolWorkspace = opts?.workspace ?? '';

    // 确保 threadStore 中的 thread 和 turn 存在
    const threadStore = this.agent.thread;
    let thread = await threadStore.getThread(threadId);
    if (!thread) {
      const title = typeof userMessage.content === 'string'
        ? userMessage.content.slice(0, 50)
        : 'New thread';
      thread = await threadStore.createThread(this.agent.config.id, title, threadId, { userId: toolUserId || undefined });
    }
    const turn = await threadStore?.createTurn(threadId);
    this.currentTurnId = turn?.id ?? '';

    // 记录用户消息
    if (threadStore && this.currentTurnId) {
      await threadStore.appendEntry({
        threadId,
        turnId: this.currentTurnId,
        role: userMessage.role,
        content: typeof userMessage.content === 'string' ? userMessage.content : JSON.stringify(userMessage.content),
      });
    }

    try {
      this.applySteerBuffer(messages);

      while (steps < this.agent.config.maxSteps && !this.interrupted) {
        if (signal.aborted) {
          if (threadStore && this.currentTurnId) {
            await threadStore.updateTurn(this.currentTurnId, { status: 'aborted', steps });
          }
          turnSpan.end({ status: 'aborted' });
          return { status: 'aborted', steps, usage, messages };
        }

        yield this.emit({ type: 'step_start', step: steps + 1 });

        yield* this.tryCompact(messages, signal);

        if (this.tokenEconomy?.isInputExhausted()) {
          yield this.emit({ type: 'error', message: 'Input token budget exhausted' });
          break;
        }

        yield* this.callModel(messages, threadId, scopeId, signal, usage, steps);

        // 记录 assistant 消息到 threadStore
        const assistantMsg = messages.at(-1);
        if (threadStore && this.currentTurnId && assistantMsg?.role === 'assistant') {
          await threadStore.appendEntry({
            threadId,
            turnId: this.currentTurnId,
            role: assistantMsg.role,
            content: assistantMsg.content,
            toolCalls: assistantMsg.toolCalls,
          });
        }

        const toolCalls = (messages.at(-1) as { toolCalls?: ToolCall[] } | undefined)?.toolCalls ?? [];
        if (toolCalls.length === 0) {
          yield this.emit({ type: 'step_end', step: steps + 1 });
          break;
        }

        yield* this.executeToolCalls(toolCalls, messages, threadId, toolUserId, toolWorkspace);

        // 记录 tool 消息到 threadStore
        if (threadStore && this.currentTurnId) {
          for (const msg of messages.slice(-toolCalls.length)) {
            if (msg.role === 'tool') {
              await threadStore.appendEntry({
                threadId,
                turnId: this.currentTurnId,
                role: msg.role,
                content: msg.content,
                toolCallId: msg.toolCallId,
              });
            }
          }
        }

        yield this.emit({ type: 'step_end', step: steps + 1 });
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

      if (threadStore && this.currentTurnId) {
        const finalStatus = this.interrupted ? 'aborted' : 'completed';
        await threadStore.updateTurn(this.currentTurnId, { status: finalStatus, steps });
      }

      turnSpan.end({ status: 'completed', steps });
      yield this.emit({ type: 'done', usage });

      return {
        status: this.interrupted ? 'interrupted' : 'completed',
        steps,
        usage,
        messages,
      };
    } catch (err) {
      if (threadStore && this.currentTurnId) {
        await threadStore.updateTurn(this.currentTurnId, { status: 'failed', steps });
      }
      const message = err instanceof Error ? err.message : String(err);
      turnSpan.error(err as Error);
      yield this.emit({ type: 'error', message });
      return { status: 'failed', steps, usage, messages };
    }
  }

  /** emit 并返回事件，方便 yield this.emit(...) 一行走两路 */
  private emit<T extends TurnEvent>(event: T): T {
    this.events.emit(event as unknown as SSEEvent);
    return event;
  }

  /** 排干 steer 缓冲区并追加到消息列表 */
  private applySteerBuffer(messages: ModelMessage[]): void {
    const text = this.drainSteerBuffer();
    if (text) {
      messages.push({ role: 'user', content: text });
    }
  }

  /** 压缩检查 */
  private async *tryCompact(messages: ModelMessage[], signal: AbortSignal): AsyncGenerator<TurnEvent> {
    if (!this.compactor) return;
    const result = await this.compactor.compactIfNeeded(messages, this.agent.model, signal);
    if (result.wasCompacted) {
      messages.length = 0;
      messages.push(...result.compacted);
      yield this.emit({ type: 'compacted', removedTokens: result.removedTokens });
    }
  }

  /** 洋葱管道 + 调用模型，流式返回过程事件，结果直接追加到 messages */
  private async *callModel(
    messages: ModelMessage[],
    threadId: string,
    scopeId: string,
    signal: AbortSignal,
    usage: { input: number; output: number },
    step: number,
  ): AsyncGenerator<TurnEvent> {
    const ctx = new ModelRequestContext({
      agent: this.agent.config,
      messages: [...messages],
      tools: [...this.agent.tools],
      threadId,
      scopeId,
    });
    await this.pipeline.run(ctx);
    const request = buildModelRequest(ctx);
    request.abortSignal = signal;

    let fullText = '';
    const toolCalls: ToolCall[] = [];
    const modelSpan = this.spanTracker.startSpan('model_step', { step: step + 1 });

    for await (const chunk of this.agent.model.stream(request)) {
      switch (chunk.type) {
        case 'text_delta':
          fullText += chunk.content;
          yield this.emit({ type: 'text_delta', content: chunk.content });
          break;
        case 'reasoning_delta':
          yield this.emit({ type: 'reasoning_delta', content: chunk.content });
          break;
        case 'tool_call_complete':
          toolCalls.push({ id: chunk.id, name: chunk.name, args: chunk.args });
          yield this.emit({ type: 'tool_call_start', id: chunk.id, name: chunk.name, args: chunk.args });
          break;
        case 'usage':
          usage.input += chunk.input;
          usage.output += chunk.output;
          this.tokenEconomy?.track(chunk.input, chunk.output);
          break;
        case 'error':
          modelSpan.error(new Error(chunk.message));
          yield this.emit({ type: 'error', message: chunk.message });
          break;
      }
    }

    modelSpan.end({ textLength: fullText.length, toolCalls: toolCalls.length });

    if (fullText || toolCalls.length > 0) {
      messages.push({ role: 'assistant', content: fullText, ...(toolCalls.length > 0 && { toolCalls }) });
    }
  }

  /** 执行工具调用并将结果追加到 messages */
  private async *executeToolCalls(
    toolCalls: ToolCall[],
    messages: ModelMessage[],
    threadId: string,
    userId: string,
    workspace: string,
  ): AsyncGenerator<TurnEvent> {
    const toolSpan = this.spanTracker.startSpan('tool_call', { count: toolCalls.length });
    let results: ToolResult[];
    try {
      results = await this.dispatchTools(toolCalls, threadId, userId, workspace);
      toolSpan.end({ results: results.length });
    } catch (err) {
      toolSpan.error(err as Error);
      throw err;
    }

    for (const r of results) {
      const raw = r.status === 'success' ? JSON.stringify(r.output) : '';
      const truncated = this.tokenEconomy?.truncateToolOutput(raw) ?? raw;
      messages.push({ role: 'tool', content: truncated, toolCallId: r.callId });
      yield this.emit({
        type: 'tool_result',
        id: r.callId,
        name: r.name,
        status: r.status,
        output: r.output,
      });
    }
  }

  private async dispatchTools(calls: ToolCall[], threadId: string, userId: string, workspace: string): Promise<ToolResult[]> {
    const context: ToolExecutionContext = {
      userId,
      agentId: this.agent.config.id,
      threadId,
      workspace,
      awaitApproval: async (call: ToolCall) => {
        if (this.approvalGate) {
          return this.approvalGate.requestApproval(call);
        }
        return { approved: true };
      },
      signal: new AbortController().signal,
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

/** 消费流式 turn 并返回最终结果（丢弃中间事件） */
export async function collectTurnResult(
  stream: AsyncGenerator<TurnEvent, TurnResult>,
): Promise<TurnResult> {
  let result: TurnResult | undefined;
  while (true) {
    const { done, value } = await stream.next();
    if (done) {
      result = value;
      break;
    }
  }
  return result!;
}
