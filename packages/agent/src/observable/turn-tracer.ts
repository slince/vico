// @vico/agent - TurnTracer: subscribes to AgentLoop events, collects spans, outputs structured trace on turn end
import {randomUUID} from 'node:crypto';
import type {EventRecorder} from '../events/types.js';
import type {TurnEvent, TurnResult} from '../agent-loop/types.js';
import type {CallModelResult} from '../agent-loop/agent-loop.js';
import type {ModelMessage, ModelRequest} from '../model/types.js';
import type {Thread} from '../thread/types.js';
import type {ToolResult} from '../tool/types.js';
import type {Span, SpanState, SpanType} from './types.js';
import type {TraceAdapter} from './trace-adapter.js';

/** 追踪级别：0=关闭，1=console，2=console+文件 */
export type TraceLevel = 0 | 1 | 2;

/** 单步追踪数据（含 model call 信息，两者 1:1） */
interface StepTrace {
  index: number;
  toolResults: ToolResult[];
  request?: ModelRequest;
  response?: CallModelResult;
}

/** 单轮完整追踪数据 */
export interface TurnTrace {
  threadId: string;
  userMessage: string;
  startTime: number;
  endTime?: number;
  steps: StepTrace[];
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
      events: [],
      spans: this.spans,
    };
    this.unsubscribe = this.subscribe(events);
  }

  /**
   * 启动一个追踪 Span。
   * @param type - Span 类型
   * @param metadata - 可选的 Span 元数据
   * @param parentSpanId - 可选的父 Span ID，用于构建层级关系
   * @returns 包含 id、end() 和 error() 方法的 Span 对象
   */
  startSpan(type: SpanType, metadata?: Record<string, unknown>, parentSpanId?: string): Span {
    const id = randomUUID();
    const state: SpanState = { id, type, parentSpanId, metadata: metadata ?? {}, startTime: Date.now() };
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
   * 记录 LLM 请求参数。不依赖事件驱动的 currentStep，直接查找或创建 step。
   * @param stepIndex - 当前 step 序号（0-based）
   * @param request - 模型请求参数
   */
  recordModelRequest(stepIndex: number, request: ModelRequest): void {
    const idx = stepIndex + 1; // 转为 1-based，与 step-start 事件一致
    const stepTrace = this.getOrCreateStep(idx);
    stepTrace.request = request;
  }

  /**
   * 记录 LLM 响应结果。
   * @param stepIndex - 当前 step 序号（0-based）
   * @param response - 模型调用返回结果
   */
  recordModelResponse(stepIndex: number, response: CallModelResult): void {
    const idx = stepIndex + 1;
    const stepTrace = this.getOrCreateStep(idx);
    stepTrace.response = response;
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

  /** 按 index 查找已有 step，不存在则创建并推入 trace.steps */
  private getOrCreateStep(index: number): StepTrace {
    const existing = this.trace.steps.find((s) => s.index === index);
    if (existing) return existing;
    const step: StepTrace = { index, toolResults: [] };
    this.trace.steps.push(step);
    return step;
  }

  private subscribe(events: EventRecorder<TurnEvent>): () => void {
    const handler = (event: TurnEvent) => {
      this.trace.events.push(event);

      switch (event.type) {
        case 'step-start':
          this.currentStep = this.getOrCreateStep(event.step);
          break;
        case 'tool-result':
          if (this.currentStep) {
            this.currentStep.toolResults.push({ callId: event.id, name: event.name, status: event.status, output: event.output });
          }
          break;
        case 'step-end':
          this.currentStep = undefined;
          break;
      }
    };

    events.on('*', handler);
    return () => events.off('*', handler);
  }
}

// ── TurnTracer — 协调器 ──

/**
 * TurnTracer — 追踪协调器。
 * 负责 turn 级生命周期管理（创建 session → 委托适配器输出/导出）。
 * 每个 turn 通过 startTurn() 创建独立的 TurnTraceSession，并发安全。
 */
export class TurnTracer {
  /** turnId → TurnTraceSession，支持暂停恢复时复用同一会话 */
  private sessions = new Map<string, TurnTraceSession>();

  constructor(
    private readonly events: EventRecorder<TurnEvent>,
    private readonly adapters: ReadonlyArray<TraceAdapter>,
  ) {}

  /**
   * 为当前 turn 获取或创建追踪会话。
   * 若该 turnId 已有暂停的会话则复用（保证 trace 不分裂），否则创建新会话。
   * @param thread - 当前 Thread 对象
   * @param userMessage - 用户消息
   * @param turnId - 当前 turn ID，用于暂停恢复时匹配会话
   * @returns TurnTraceSession 实例
   */
  startTurn(thread: Thread, userMessage: ModelMessage, turnId: string): TurnTraceSession {
    const existing = this.sessions.get(turnId);
    if (existing) return existing;

    const session = new TurnTraceSession(thread, userMessage, this.events);
    this.sessions.set(turnId, session);
    return session;
  }

  /**
   * 结束 turn：从 session 提取数据，委托所有适配器输出/导出，并清理会话。
   * @param traceSession - 当前 Turn 的追踪会话
   * @param result - Turn 最终结果
   * @param turnId - 当前 turn ID，用于清理会话映射
   */
  async finish(traceSession: TurnTraceSession, result: TurnResult, turnId: string): Promise<void> {
    this.sessions.delete(turnId);
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
