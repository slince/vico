// @vico/agent - TurnTracer: manages turn-level trace lifecycle, event subscription, span collection, and adapter output
import {randomUUID} from 'node:crypto';
import type {EventRecorder} from '../events/types.js';
import type {TurnEvent} from '../agent-loop/types.js';
import type {ModelMessage, ModelRequest} from '../model/types.js';
import type {Thread} from '../thread/thread-store.js';
import type {ToolResult} from '../tool/types.js';
import type {Span, SpanState, SpanType} from './types.js';
import type {TraceAdapter} from './trace-adapter.js';
import {Stack} from '../utils/Stack.js';
import {CallModelResult, TurnResult} from "../agent-loop/agent-loop-options.js";

/** 追踪级别：0=关闭，1=console，2=console+文件 */
export type TraceLevel = 0 | 1 | 2;

/** 单步追踪数据（含 model call 信息，两者 1:1） */
interface StepTrace {
  index: number;
  toolResults: ToolResult[];
  request?: ModelRequest;
  response?: CallModelResult;
}

// ── TurnTrace — 数据容器 + Span 派生 ──

/**
 * TurnTrace — 单个 turn 的完整追踪数据。
 * 既是数据容器（供适配器导出），也能派生 Span、记录 model 请求/响应。
 * 事件处理由 TurnTracer 委托调用 handleEvent()。
 */
export class TurnTrace {
  readonly threadId: string;
  readonly userMessage: string;
  readonly startTime: number;
  endTime?: number;
  steps: StepTrace[] = [];
  events: TurnEvent[] = [];
  spans: SpanState[] = [];
  result?: TurnResult;

  private currentStep?: StepTrace;
  /** 活跃 span 栈，栈顶为当前未结束的 span，自动作为子 span 的父级 */
  private activeSpans = new Stack<SpanState>();

  constructor(thread: Thread, userMessage: ModelMessage) {
    this.threadId = thread.id;
    this.userMessage = userMessage.content;
    this.startTime = Date.now();
  }

  /**
   * 启动一个追踪 Span。自动将栈顶未结束的 span 作为父级，构建父子层级。
   * Spans 按 LIFO 顺序结束——子 span 必须先于父 span 结束。
   * @param type - Span 类型
   * @param metadata - 可选的 Span 元数据
   * @returns 包含 id、end() 和 error() 方法的 Span 对象
   */
  startSpan(type: SpanType, metadata?: Record<string, unknown>): Span {
    const parent = this.activeSpans.peek();
    const parentSpanId = parent?.id;

    const id = randomUUID();
    const state: SpanState = { id, type, parentSpanId, metadata: metadata ?? {}, startTime: Date.now() };
    this.spans.push(state);
    this.activeSpans.push(state);

    return {
      id,
      end: (result?: Record<string, unknown>) => {
        state.endTime = Date.now();
        state.result = result;
        this.activeSpans.pop();
      },
      error: (err: Error) => {
        state.endTime = Date.now();
        state.error = err.message;
        this.activeSpans.pop();
      },
    };
  }

  /**
   * 记录 LLM 请求参数。
   * @param stepIndex - 当前 step 序号（0-based）
   * @param request - 模型请求参数
   */
  recordModelRequest(stepIndex: number, request: ModelRequest): void {
    const step = this.getOrCreateStep(stepIndex + 1);
    step.request = request;
  }

  /**
   * 记录 LLM 响应结果。
   * @param stepIndex - 当前 step 序号（0-based）
   * @param response - 模型调用返回结果
   */
  recordModelResponse(stepIndex: number, response: CallModelResult): void {
    const step = this.getOrCreateStep(stepIndex + 1);
    step.response = response;
  }

  /**
   * 处理 TurnEvent — 由 TurnTracer 的事件订阅调用。
   * 负责维护 currentStep 状态和 toolResults 收集。
   */
  handleEvent(event: TurnEvent): void {
    this.events.push(event);

    switch (event.type) {
      case 'step-start':
        this.currentStep = this.getOrCreateStep(event.step);
        break;
      case 'tool-result':
        if (this.currentStep) {
          this.currentStep.toolResults.push({
            callId: event.id,
            name: event.name,
            status: event.status,
            output: event.output,
          });
        }
        break;
      case 'step-end':
        this.currentStep = undefined;
        break;
    }
  }

  /**
   * 封账：设置 endTime 和 result（由 TurnTracer.finish() 调用）。
   */
  finalize(result: TurnResult): void {
    this.endTime = Date.now();
    this.result = result;
  }

  // ── 内部方法 ──

  /** 按 index 查找已有 step，不存在则创建并推入 steps */
  private getOrCreateStep(index: number): StepTrace {
    const existing = this.steps.find((s) => s.index === index);
    if (existing) return existing;
    const step: StepTrace = { index, toolResults: [] };
    this.steps.push(step);
    return step;
  }
}

// ── TurnTracer — 生命周期 + 事件管理 ──

/**
 * TurnTracer — 追踪协调器。
 * 负责 turn 级生命周期管理：事件订阅/卸载、会话复用（暂停恢复）、适配器输出。
 */
export class TurnTracer {
  /** turnId → { trace, unsubscribe }，支持暂停恢复时复用同一 trace */
  private sessions = new Map<string, { trace: TurnTrace; unsubscribe: () => void }>();

  constructor(
    private readonly events: EventRecorder<TurnEvent>,
    private readonly adapters: ReadonlyArray<TraceAdapter>,
  ) {}

  /**
   * 为当前 turn 获取或创建追踪数据。
   * 若该 turnId 已有暂停的 trace 则复用（保证 trace 不分裂），否则创建新 trace 并订阅事件。
   * @param thread - 当前 Thread 对象
   * @param userMessage - 用户消息
   * @param turnId - 当前 turn ID
   * @returns TurnTrace 实例
   */
  create(thread: Thread, userMessage: ModelMessage, turnId: string): TurnTrace {
    const existing = this.sessions.get(turnId);
    if (existing) return existing.trace;

    const trace = new TurnTrace(thread, userMessage);
    const handler = (e: TurnEvent) => trace.handleEvent(e);
    this.events.on('*', handler);
    this.sessions.set(turnId, { trace, unsubscribe: () => this.events.off('*', handler) });
    return trace;
  }

  /**
   * 结束 turn：卸载事件订阅，封账 trace，委托适配器输出。
   * @param trace - 当前 Turn 的追踪数据
   * @param result - Turn 最终结果
   * @param turnId - 当前 turn ID
   */
  async finish(trace: TurnTrace, result: TurnResult, turnId: string): Promise<void> {
    const entry = this.sessions.get(turnId);
    if (entry) {
      entry.unsubscribe();
      this.sessions.delete(turnId);
    }
    trace.finalize(result);

    for (const adapter of this.adapters) {
      try {
        await adapter.write(trace);
      } catch {
        // 适配器失败不影响主流程
      }
    }
  }
}
