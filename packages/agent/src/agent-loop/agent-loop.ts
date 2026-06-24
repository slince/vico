// @vico/agent - AgentLoop core engine: drives the model→tool→repeat loop for a single turn
import type {RunTurnOptions, ToolCallSession, TurnEvent, TurnResult} from './types.js';
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

        yield this.emit({ type: 'step-start', step: steps + 1 });

        yield* this.tryCompact(messages, signal);

        if (this.tokenEconomy?.isInputExhausted()) {
          yield this.emit({ type: 'error', message: 'Input token budget exhausted' });
          break;
        }

        yield* this.callModel(messages, threadId, scopeId, signal, usage, steps);

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

        const toolCalls = messages.at(-1)?.toolCalls ?? [];
        if (toolCalls.length === 0) {
          yield this.emit({ type: 'step-end', step: steps + 1 });
          break;
        }

        yield* this.executeToolCalls(toolCalls, messages, session);

        // 记录 tool 消息到 threadStore
        if (threadStore && turn) {
          for (const msg of messages.slice(-toolCalls.length)) {
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

        yield this.emit({ type: 'step-end', step: steps + 1 });
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
      yield this.emit({ type: 'done', usage });

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
      const message = err instanceof Error ? err.message : String(err);
      turnSpan.error(err as Error);
      yield this.emit({ type: 'error', message });
      return { status: 'failed', steps, usage, messages };
    }
  }

  /** emit 并返回事件，方便 yield this.emit(...) 一行走两路 */
  private emit(event: TurnEvent): TurnEvent {
    this.events.emit(event);
    return event;
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
  private async *tryCompact(messages: ModelMessage[], signal: AbortSignal): AsyncGenerator<TurnEvent> {
    if (!this.compactor) return;
    const result = await this.compactor.compactIfNeeded(messages, this.agent.modelClient, signal);
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

    let fullText = '';
    const toolCalls: ToolCall[] = [];
    const modelSpan = this.spanTracker.startSpan('model_step', { step: step + 1 });

    const { stream } = await this.agent.modelClient.stream({
      system: request.system,
      messages: request.messages,
      tools: request.tools,
      maxOutputTokens: request.maxTokens,
      temperature: request.temperature,
      abortSignal: signal,
    });

    try {
      for await (const chunk of stream) {
        switch (chunk.type) {
          case 'text-delta':
            fullText += chunk.delta;
            yield this.emit({ type: 'text-delta', content: chunk.delta });
            break;
          case 'reasoning-delta':
            yield this.emit({ type: 'reasoning-delta', content: chunk.delta });
            break;
          case 'tool-call':
            toolCalls.push({ id: chunk.toolCallId, name: chunk.toolName, args: (chunk.input ?? {}) as Record<string, unknown> });
            yield this.emit({ type: 'tool-call-start', id: chunk.toolCallId, name: chunk.toolName, args: (chunk.input ?? {}) as Record<string, unknown> });
            break;
          case 'finish':
            if (chunk.usage) {
              usage.input += chunk.usage.inputTokens.total ?? 0;
              usage.output += chunk.usage.outputTokens.total ?? 0;
              this.tokenEconomy?.track(chunk.usage.inputTokens.total ?? 0, chunk.usage.outputTokens.total ?? 0);
            }
            break;
          case 'error':
            const errMsg = chunk.error instanceof Error ? chunk.error.message : String(chunk.error);
            modelSpan.error(new Error(errMsg));
            yield this.emit({ type: 'error', message: errMsg });
            break;
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      modelSpan.error(new Error(msg));
      yield this.emit({ type: 'error', message: msg });
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
    session: ToolCallSession,
  ): AsyncGenerator<TurnEvent> {
    const toolSpan = this.spanTracker.startSpan('tool_call', { count: toolCalls.length });
    let results: ToolResult[];
    try {
      results = await this.dispatchTools(toolCalls, session);
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
        type: 'tool-result',
        id: r.callId,
        name: r.name,
        status: r.status,
        output: r.output,
      });
    }
  }

  private async dispatchTools(calls: ToolCall[], session: ToolCallSession): Promise<ToolResult[]> {
    const context: ToolExecutionContext = {
      session,
      agentId: this.agent.config.id,
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
