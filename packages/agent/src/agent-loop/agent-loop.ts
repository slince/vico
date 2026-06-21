// @vico/agent - AgentLoop core engine: drives the model→tool→repeat loop for a single turn
import type { TurnResult, AgentLoopOptions } from './types.js';
import type { ModelClient, ModelMessage } from '../model/types.js';
import type { ToolHost, ToolExecutionContext } from '../tool/types.js';
import type { ToolCall, ToolResult, ToolSpec } from '../tool/types.js';
import type { EventRecorder } from '../observable/event-recorder.js';
import type { SpanTracker } from '../observable/span-tracker.js';
import type { CompositeHookRunner } from '../hook/hook-runner.js';
import { ContextCompactor } from './context-compactor.js';
import type { TokenEconomy } from './token-economy.js';
import type { ApprovalGate } from './approval-gate.js';
import type { ContextProcessor } from '../prompt/context-processor.js';
import { OnionPipeline, buildModelRequest, ModelRequestContext } from '../prompt/context-processor.js';
import { DynamicInstructionProcessor } from './dynamic-instruction-processor.js';

export type { TurnResult, AgentLoopOptions } from './types.js';

/** AgentLoop — 编排 model→tool→repeat 循环 */
export class AgentLoop {
  private config: AgentLoopOptions['config'];
  private model: ModelClient;
  private toolHost: ToolHost;
  private compactor?: ContextCompactor;
  private tokenEconomy?: TokenEconomy;
  private approvalGate?: ApprovalGate;
  private hooks?: CompositeHookRunner;
  private events: EventRecorder;
  private spanTracker: SpanTracker;
  private steerBuffer: string[] = [];
  private interrupted = false;

  private pipeline: OnionPipeline;
  private boundTools: ToolSpec[];

  constructor(options: AgentLoopOptions) {
    this.config = options.config;
    this.model = options.model;
    this.toolHost = options.toolHost;
    this.compactor = options.compactor;
    this.tokenEconomy = options.tokenEconomy;
    this.approvalGate = options.approvalGate;
    this.hooks = options.hooks;
    this.events = options.events;
    this.spanTracker = options.spanTracker;
    this.boundTools = options.boundTools ?? [];

    // 用户提供的处理器 + 内置 DynamicInstructionProcessor
    const userProcessors = options.processors ?? [];
    const steerProcessor = new DynamicInstructionProcessor(() => {
      const text = this.drainSteerBuffer();
      return text ? [text] : [];
    });
    this.pipeline = new OnionPipeline([...userProcessors, steerProcessor]);

    // 注册 updateWorkingMemory 工具 handler
    if (options.workingMemory) {
      const wm = options.workingMemory;
      const template = wm.getTemplate();

      this.toolHost.registerHandler('updateWorkingMemory', {
        execute: async (call, ctx) => {
          const args = call.args as { memory: string };
          if (!args.memory || typeof args.memory !== 'string') {
            throw new Error('updateWorkingMemory requires a "memory" string argument');
          }
          const scopeId = wm.scope === 'user' ? ctx.userId : ctx.workspace;
          // 防退化保护：拒绝用空模板覆盖已有数据
          const current = await wm.get(scopeId);
          if (current && args.memory.trim() === template.trim()) {
            throw new Error('Refusing to replace working memory with empty template');
          }
          await wm.set(scopeId, args.memory);
          return 'Working memory updated';
        },
      });
    }
  }

  /**
   * 执行一个完整的 turn。
   */
  async runTurn(
    threadId: string,
    history: ModelMessage[],
    userMessage: ModelMessage,
    signal: AbortSignal,
    opts?: { scopeId?: string; userId?: string; workspace?: string },
  ): Promise<TurnResult> {
    const turnSpan = this.spanTracker.startSpan('agent_run');
    this.interrupted = false;

    const messages = [...history, userMessage];
    let steps = 0;
    const usage = { input: 0, output: 0 };
    const scopeId = opts?.scopeId ?? '';
    const toolUserId = opts?.userId ?? '';
    const toolWorkspace = opts?.workspace ?? '';

    try {
      // 1. 前置：排干 steer 缓冲区，作为用户消息追加
      const steerText = this.drainSteerBuffer();
      if (steerText) {
        messages.push({ role: 'user', content: steerText });
      }

      // 2. turn:start hooks
      if (this.hooks) {
        const hookResult = await this.hooks.runAll('turn:start', { threadId, messages });
        if (hookResult.action === 'deny') {
          turnSpan.end({ status: 'denied' });
          return { status: 'interrupted', steps: 0, usage, messages };
        }
      }

      // 3. 主循环：model → tool → repeat
      while (steps < this.config.maxSteps && !this.interrupted) {
        if (signal.aborted) {
          turnSpan.end({ status: 'aborted' });
          return { status: 'aborted', steps, usage, messages };
        }

        // 3.0 压缩检查
        if (this.compactor) {
          const compactResult = await this.compactor.compactIfNeeded(messages, this.model, signal);
          if (compactResult.wasCompacted) {
            messages.length = 0;
            messages.push(...compactResult.compacted);
            this.events.emit({ type: 'compacted', removedTokens: compactResult.removedTokens });
          }
        }

        this.events.emit({ type: 'step_start', step: steps + 1 });

        if (this.tokenEconomy?.isInputExhausted()) {
          this.events.emit({ type: 'error', message: 'Input token budget exhausted' });
          break;
        }

        // 3.1 洋葱管道：创建上下文 → 执行处理器 → 构建 ModelRequest
        const ctx = new ModelRequestContext({
          agent: this.config,
          messages: [...messages],
          tools: [...this.boundTools],
          threadId,
          scopeId,
        });
        await this.pipeline.run(ctx);
        const request = buildModelRequest(ctx);
        request.abortSignal = signal;

        // 3.2 调用模型
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
            default:
              break;
          }
        }

        modelSpan.end({ textLength: fullText.length, toolCalls: toolCalls.length });

        // 3.3 追加 assistant 消息
        if (fullText || toolCalls.length > 0) {
          messages.push({
            role: 'assistant',
            content: fullText,
            ...(toolCalls.length > 0 && { toolCalls }),
          });
        }

        // 3.4 无工具调用则结束
        if (toolCalls.length === 0) {
          this.events.emit({ type: 'step_end', step: steps + 1 });
          break;
        }

        // 3.5 执行工具
        const toolSpan = this.spanTracker.startSpan('tool_call', { count: toolCalls.length });
        let toolResults: ToolResult[];
        try {
          toolResults = await this.dispatchTools(toolCalls, threadId, toolUserId, toolWorkspace);
          toolSpan.end({ results: toolResults.length });
        } catch (err) {
          toolSpan.error(err as Error);
          throw err;
        }

        // 3.6 追加工具结果
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

      // 4. 洋葱管道离开阶段：循环结束后逆序执行 resolve()
      await this.pipeline.resolve(
        new ModelRequestContext({
          agent: this.config,
          messages: [...messages],
          tools: [...this.boundTools],
          threadId,
          scopeId,
        }),
      );

      // 5. turn:end hooks
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

  private async dispatchTools(calls: ToolCall[], threadId: string, userId: string, workspace: string): Promise<ToolResult[]> {
    const context: ToolExecutionContext = {
      userId,
      agentId: this.config.id,
      threadId,
      workspace,
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
