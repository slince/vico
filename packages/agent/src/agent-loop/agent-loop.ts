// @vico/agent - AgentLoop core engine: drives the model→tool→repeat loop for a single turn
import type { TurnResult, AgentLoopOptions } from './types.js';
import type { ModelClient, ModelMessage } from '../model/model-client.js';
import type { PromptContext } from '../prompt/types.js';
import { PromptAssembler } from '../prompt/assembler.js';
import type { ToolHost, ToolExecutionContext } from '../tool/tool-host.js';
import type { ToolCall, ToolResult } from '../contracts/tool.js';
import type { EventRecorder } from '../observable/event-recorder.js';
import type { SpanTracker } from '../observable/span-tracker.js';
import type { CompositeHookRunner } from '../hook/hook-runner.js';
import { ContextCompactor } from './context-compactor.js';
import type { TokenEconomy } from './token-economy.js';
import type { ApprovalGate } from './approval-gate.js';

export type { TurnResult, AgentLoopOptions } from './types.js';

/** AgentLoop — 编排 model→tool→repeat 循环 */
export class AgentLoop {
  private config: AgentLoopOptions['config'];
  private model: ModelClient;
  private toolHost: ToolHost;
  private promptAssembler: PromptAssembler;
  private compactor?: ContextCompactor;
  private tokenEconomy?: TokenEconomy;
  private approvalGate?: ApprovalGate;
  private hooks?: CompositeHookRunner;
  private events: EventRecorder;
  private spanTracker: SpanTracker;
  private steerBuffer: string[] = [];
  private interrupted = false;

  constructor(options: AgentLoopOptions) {
    this.config = options.config;
    this.model = options.model;
    this.toolHost = options.toolHost;
    this.promptAssembler = options.promptAssembler;
    this.compactor = options.compactor;
    this.tokenEconomy = options.tokenEconomy;
    this.approvalGate = options.approvalGate;
    this.hooks = options.hooks;
    this.events = options.events;
    this.spanTracker = options.spanTracker;
  }

  /**
   * 执行一个完整的 turn。
   *
   * 主流程：
   * 1. 排干 steer 缓冲区，将引导文本追加到消息
   * 2. 执行 turn:start hooks（deny 时提前终止）
   * 3. 进入主循环：组装 prompt → 调用模型 → 执行工具 → 追加结果 → 重复
   * 4. 执行 turn:end hooks
   * 5. 返回 TurnResult
   */
  async runTurn(
    threadId: string,
    history: ModelMessage[],
    userMessage: ModelMessage,
    signal: AbortSignal,
  ): Promise<TurnResult> {
    const turnSpan = this.spanTracker.startSpan('agent_run');
    this.interrupted = false;

    const messages = [...history, userMessage];
    let steps = 0;
    const usage = { input: 0, output: 0 };

    try {
      // 1. 前置：排干 steer 缓冲区，将引导文本注入对话
      const steerText = this.drainSteerBuffer();
      if (steerText) {
        messages.push({ role: 'user', content: steerText });
      }

      // 2. 执行 turn:start hooks
      if (this.hooks) {
        const hookResult = await this.hooks.runAll('turn:start', { threadId, messages });
        if (hookResult.action === 'deny') {
          turnSpan.end({ status: 'denied' });
          return { status: 'interrupted', steps: 0, usage, messages };
        }
      }

      // 3. 主循环：model → tool → repeat
      while (steps < this.config.maxSteps && !this.interrupted) {
        // 检查外部中断信号
        if (signal.aborted) {
          turnSpan.end({ status: 'aborted' });
          return { status: 'aborted', steps, usage, messages };
        }

        // 3.0 压缩检查（上下文窗口保护）
        if (this.compactor) {
          const compactResult = await this.compactor.compactIfNeeded(messages, this.model, signal);
          if (compactResult.wasCompacted) {
            // 用压缩后的消息替换当前消息列表
            messages.length = 0;
            messages.push(...compactResult.compacted);
            this.events.emit({ type: 'compacted', removedTokens: compactResult.removedTokens });
          }
        }

        this.events.emit({ type: 'step_start', step: steps + 1 });

        // 检查 token 预算
        if (this.tokenEconomy?.isInputExhausted()) {
          this.events.emit({ type: 'error', message: 'Input token budget exhausted' });
          break;
        }

        // 3.1 组装 prompt
        const promptCtx = this.buildPromptContext(messages);
        const request = this.promptAssembler.assemble(promptCtx);
        request.abortSignal = signal;

        // 3.2 调用模型并收集流式响应
        let fullText = '';
        const toolCalls: ToolCall[] = [];

        const modelSpan = this.spanTracker.startSpan('model_step', { step: steps + 1 });

        for await (const chunk of this.model.stream(request)) {
          switch (chunk.type) {
            case 'text_delta':
              fullText += chunk.content;
              this.events.emit({ type: 'text_delta', content: chunk.content });
              break;
            case 'reasoning_delta':
              this.events.emit({ type: 'reasoning_delta', content: chunk.content });
              break;
            case 'tool_call_complete':
              toolCalls.push({ id: chunk.id, name: chunk.name, args: chunk.args });
              this.events.emit({
                type: 'tool_call_start',
                id: chunk.id,
                name: chunk.name,
              });
              break;
            case 'usage':
              usage.input += chunk.input;
              usage.output += chunk.output;
              this.tokenEconomy?.track(chunk.input, chunk.output);
              break;
            case 'error':
              modelSpan.error(new Error(chunk.message));
              this.events.emit({ type: 'error', message: chunk.message });
              break;
            // tool_call_delta 和 completed 在 Phase 1 为 no-op，预留后续阶段使用
            default:
              break;
          }
        }

        modelSpan.end({ textLength: fullText.length, toolCalls: toolCalls.length });

        // 3.3 如果有 assistant 回复或工具调用，加入消息列表
        if (fullText || toolCalls.length > 0) {
          messages.push({
            role: 'assistant',
            content: fullText,
            ...(toolCalls.length > 0 && { toolCalls }),
          });
        }

        // 3.4 如果没有工具调用，循环结束
        if (toolCalls.length === 0) {
          this.events.emit({ type: 'step_end', step: steps + 1 });
          break;
        }

        // 3.5 执行工具调用
        const toolSpan = this.spanTracker.startSpan('tool_call', { count: toolCalls.length });
        let toolResults: ToolResult[];
        try {
          toolResults = await this.dispatchTools(toolCalls, threadId);
          toolSpan.end({ results: toolResults.length });
        } catch (err) {
          toolSpan.error(err as Error);
          throw err;
        }

        // 3.6 将工具结果追加到消息列表
        for (const result of toolResults) {
          const raw = result.status === 'success' ? JSON.stringify(result.output) : '';
          const truncated = this.tokenEconomy?.truncateToolOutput(raw) ?? raw;
          messages.push({
            role: 'tool',
            content: truncated,
            toolCallId: result.callId,
          });
          this.events.emit({
            type: 'tool_result',
            id: result.callId,
            name: result.name,
            status: result.status,
            output: result.output,
          });
        }

        this.events.emit({ type: 'step_end', step: steps + 1 });
        steps++;
      }

      // 4. 后置：turn:end hooks
      if (this.hooks) {
        await this.hooks.runAll('turn:end', { threadId, messages, usage });
      }

      turnSpan.end({ status: 'completed', steps });
      this.events.emit({ type: 'done', usage });
      return {
        status: this.interrupted ? 'interrupted' : 'completed',
        steps,
        usage,
        messages,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      turnSpan.error(err as Error);
      this.events.emit({ type: 'error', message });
      return { status: 'failed', steps, usage, messages };
    }
  }

  /**
   * 工具分发
   */
  private async dispatchTools(calls: ToolCall[], threadId: string): Promise<ToolResult[]> {
    const context: ToolExecutionContext = {
      tenantId: this.config.tenantId,
      userId: '',
      agentId: this.config.id,
      threadId,
      workspace: '',
      awaitApproval: async (call: ToolCall) => {
        if (this.approvalGate) {
          return this.approvalGate.requestApproval(call);
        }
        return { approved: true };
      },
      hooks: this.hooks?.getByEvent('tool:before') ?? [],
      signal: new AbortController().signal,
    };

    return this.toolHost.executeBatch(calls, context);
  }

  /** 从当前消息列表构建 PromptContext */
  private buildPromptContext(messages: ModelMessage[]): PromptContext {
    return {
      agent: this.config,
      skillCatalog: [],
      memoryItems: [],
      ragResults: [],
      history: messages,
      tools: [],
      dynamicInstructions: this.steerBuffer.length > 0 ? [this.drainSteerBuffer()] : [],
    };
  }

  /** 排干 steer 缓冲区，返回合并后的引导文本 */
  private drainSteerBuffer(): string {
    const text = this.steerBuffer.join('\n');
    this.steerBuffer = [];
    return text;
  }

  /** 中断当前正在执行的 turn */
  interrupt(): void {
    this.interrupted = true;
  }

  /** 注入引导文本，将在下一轮 model 调用前附加到对话中 */
  steer(text: string): void {
    this.steerBuffer.push(text);
  }
}
