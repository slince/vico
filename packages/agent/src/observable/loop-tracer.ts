// @vico/agent - LoopTracer: subscribes to AgentLoop events, collects spans, outputs structured trace on turn end
import { randomUUID } from 'node:crypto';
import type { EventRecorder } from '../events/types.js';
import type { Step, TurnEvent, TurnResult } from '../agent-loop/types.js';
import type { CallModelResult } from '../agent-loop/agent-loop.js';
import type { ModelMessage, ModelRequest } from '../model/types.js';
import type { Thread } from '../thread/types.js';
import type { Span, SpanState, SpanType } from './types.js';
import type { TraceAdapter } from './trace-adapters.js';

/** 追踪级别：0=关闭，1=console，2=console+文件 */
export type TraceLevel = 0 | 1 | 2;

/** 单次 LLM 调用追踪数据 */
export interface ModelCallTrace {
  stepIndex: number;
  request: ModelRequest;
  response?: CallModelResult;
}

/** 单步追踪数据 */
interface StepTrace {
  index: number;
  text: string;
  toolCalls: Array<{ id: string; name: string; args: Record<string, unknown> }>;
  toolResults: Array<{ id: string; name: string; status: string; output: unknown }>;
}

/** 单轮完整追踪数据 */
export interface TurnTrace {
  threadId: string;
  userMessage: string;
  startTime: number;
  endTime?: number;
  steps: StepTrace[];
  modelCalls: ModelCallTrace[];
  events: TurnEvent[];
  /** 本 turn 内所有 span（跟随 trace 持久化） */
  spans: SpanState[];
  result?: TurnResult;
}

// ── TurnTraceSession — 数据收集 ──

/**
 * TurnTraceSession — 单个 turn 的独立追踪会话。
 * 负责事件订阅、trace 数据收集和 span 收集。
 * 每个 turn 实例完全隔离，并发安全。
 */
export class TurnTraceSession {
  private trace: TurnTrace;
  private currentStep?: StepTrace;
  private pendingModelCalls = new Map<number, ModelCallTrace>();
  private unsubscribe: () => void;
  private spans: SpanState[] = [];

  constructor(
    thread: Thread,
    userMessage: ModelMessage,
    events: EventRecorder<TurnEvent>,
  ) {
    this.trace = {
      threadId: thread.id,
      userMessage: userMessage.content,
      startTime: Date.now(),
      steps: [],
      modelCalls: [],
      events: [],
      spans: this.spans,
    };
    this.unsubscribe = this.subscribe(events);
  }

  /**
   * 启动一个追踪 Span。
   * @param type - Span 类型
   * @param metadata - 可选的 Span 元数据
   * @returns 包含 id、end() 和 error() 方法的 Span 对象
   */
  startSpan(type: SpanType, metadata?: Record<string, unknown>): Span {
    const id = randomUUID();
    const state: SpanState = { id, type, metadata: metadata ?? {}, startTime: Date.now() };
    this.spans.push(state);

    return {
      id,
      end: (result?: Record<string, unknown>) => {
        state.endTime = Date.now();
        state.result = result;
      },
      error: (err: Error) => {
        state.endTime = Date.now();
        state.error = err.message;
      },
    };
  }

  /**
   * 记录 LLM 请求参数。
   * @param step - 当前 Step 对象
   * @param request - 模型请求参数
   */
  recordModelRequest(step: Step, request: ModelRequest): void {
    const entry: ModelCallTrace = { stepIndex: step.index, request };
    this.pendingModelCalls.set(step.index, entry);
    this.trace.modelCalls.push(entry);
  }

  /**
   * 记录 LLM 响应结果。
   * @param step - 当前 Step 对象
   * @param response - 模型调用返回结果
   */
  recordModelResponse(step: Step, response: CallModelResult): void {
    const entry = this.pendingModelCalls.get(step.index);
    if (entry) {
      entry.response = response;
      this.pendingModelCalls.delete(step.index);
    }
  }

  /**
   * 结束会话：取消事件订阅，填充 endTime 和 result，返回最终 trace。
   * @param result - Turn 最终结果
   * @returns 完整的 TurnTrace 追踪数据
   */
  finalize(result: TurnResult): TurnTrace {
    this.unsubscribe();
    this.trace.endTime = Date.now();
    this.trace.result = result;
    return this.trace;
  }

  // ── 内部方法 ──

  private subscribe(events: EventRecorder<TurnEvent>): () => void {
    const handler = (event: TurnEvent) => {
      this.trace.events.push(event);

      switch (event.type) {
        case 'step-start':
          this.currentStep = { index: event.step, text: '', toolCalls: [], toolResults: [] };
          break;
        case 'text-delta':
          if (this.currentStep) this.currentStep.text += event.content;
          break;
        case 'tool-call-start':
          if (this.currentStep) {
            this.currentStep.toolCalls.push({ id: event.id, name: event.name, args: event.args });
          }
          break;
        case 'tool-result':
          if (this.currentStep) {
            this.currentStep.toolResults.push({ id: event.id, name: event.name, status: event.status, output: event.output });
          }
          break;
        case 'step-end':
          if (this.currentStep) {
            this.trace.steps.push(this.currentStep);
            this.currentStep = undefined;
          }
          break;
      }
    };

    events.on('*', handler);
    return () => events.off('*', handler);
  }
}

// ── LoopTracer — 协调器 ──

/**
 * LoopTracer — 追踪协调器。
 * 负责 turn 级生命周期管理（创建 session → 委托适配器输出/导出）。
 * 每个 turn 通过 startTurn() 创建独立的 TurnTraceSession，并发安全。
 */
export class LoopTracer {
  constructor(
    private readonly events: EventRecorder<TurnEvent>,
    private readonly adapters: ReadonlyArray<TraceAdapter>,
  ) {}

  /**
   * 为当前 turn 创建独立的追踪会话。
   * @param thread - 当前 Thread 对象
   * @param userMessage - 用户消息
   * @returns 新的 TurnTraceSession 实例
   */
  startTurn(thread: Thread, userMessage: ModelMessage): TurnTraceSession {
    return new TurnTraceSession(thread, userMessage, this.events);
  }

  /**
   * 结束 turn：从 session 提取数据，委托所有适配器输出/导出。
   * @param traceSession - 当前 Turn 的追踪会话
   * @param result - Turn 最终结果
   */
  async finish(traceSession: TurnTraceSession, result: TurnResult): Promise<void> {
    const trace = traceSession.finalize(result);

    for (const adapter of this.adapters) {
      try {
        await adapter.write(trace);
      } catch {
        // 适配器失败不影响主流程
      }
    }
  }
}
