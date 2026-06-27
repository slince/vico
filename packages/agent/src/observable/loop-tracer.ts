// @vico/agent - LoopTracer: subscribes to AgentLoop events + spans, outputs structured trace on turn end
import type {EventRecorder} from '../events/types.js';
import type {Step, TurnEvent, TurnResult} from '../agent-loop/types.js';
import type {CallModelResult} from '../agent-loop/agent-loop.js';
import type {ModelRequest, ModelMessage} from '../model/types.js';
import type {Thread} from '../thread/types.js';
import type {SpanSession, SpanState} from './types.js';
import {TraceExporter} from './trace-exporter.js';

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
  result?: TurnResult;
}

/**
 * TurnTraceSession — 单个 turn 的独立追踪会话。
 * 纯数据持有：负责事件订阅和 trace 数据收集，不涉及输出/导出逻辑。
 * 每个 turn 实例完全隔离，并发安全。
 */
export class TurnTraceSession {
  private trace: TurnTrace;
  private currentStep?: StepTrace;
  private pendingModelCalls = new Map<number, ModelCallTrace>();
  private unsubscribe: () => void;

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
    };
    this.unsubscribe = this.subscribe(events);
  }

  /** 记录 LLM 请求参数 */
  recordModelRequest(step: Step, request: ModelRequest): void {
    const entry: ModelCallTrace = { stepIndex: step.index, request };
    this.pendingModelCalls.set(step.index, entry);
    this.trace.modelCalls.push(entry);
  }

  /** 记录 LLM 响应结果 */
  recordModelResponse(step: Step, response: CallModelResult): void {
    const entry = this.pendingModelCalls.get(step.index);
    if (entry) {
      entry.response = response;
      this.pendingModelCalls.delete(step.index);
    }
  }

  /** 结束会话：取消事件订阅，填充 endTime 和 result，返回最终 trace */
  finalize(result: TurnResult): TurnTrace {
    this.unsubscribe();
    this.trace.endTime = Date.now();
    this.trace.result = result;
    return this.trace;
  }

  // ── 内部方法 ──

  /** 订阅当前 turn 相关的 TurnEvent */
  private subscribe(events: EventRecorder<TurnEvent>): () => void {
    const handler = (event: TurnEvent) => {
      this.trace.events.push(event);

      switch (event.type) {
        case 'step-start':
          this.currentStep = {
            index: event.step,
            text: '',
            toolCalls: [],
            toolResults: [],
          };
          break;

        case 'text-delta':
          if (this.currentStep) {
            this.currentStep.text += event.content;
          }
          break;

        case 'tool-call-start':
          if (this.currentStep) {
            this.currentStep.toolCalls.push({
              id: event.id,
              name: event.name,
              args: event.args,
            });
          }
          break;

        case 'tool-result':
          if (this.currentStep) {
            this.currentStep.toolResults.push({
              id: event.id,
              name: event.name,
              status: event.status,
              output: event.output,
            });
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

/**
 * LoopTracer — 追踪协调器。
 * 负责 turn 级生命周期管理（clear span → 创建 session → 输出/导出）。
 * 每个 turn 通过 startTurn() 创建独立的 TurnTraceSession，并发安全。
 *
 * level: 0 = 不追踪（无开销）；1 = console 输出；2 = console + JSON 文件导出
 */
export class LoopTracer {
  constructor(
    private readonly events: EventRecorder<TurnEvent>,
    private readonly level: TraceLevel = 0,
  ) {}

  /** 为当前 turn 创建独立的追踪会话。level=0 时返回 undefined（零开销） */
  startTurn(thread: Thread, userMessage: ModelMessage): TurnTraceSession | undefined {
    if (this.level === 0) return;
    return new TurnTraceSession(thread, userMessage, this.events);
  }

  /** 结束 turn：从 session 提取 trace 数据，结合 span 信息输出/导出 */
  finish(traceSession: TurnTraceSession | undefined, spanSession: SpanSession, result: TurnResult): void {
    if (!traceSession) return;

    const trace = traceSession.finalize(result);
    const duration = trace.endTime! - trace.startTime;
    const spans = spanSession.getAllSpans();

    if (this.level >= 1) {
      this.printConsole(trace, duration, spans);
    }

    if (this.level >= 2) {
      TraceExporter.dump(trace, spans).catch(() => {
        // 静默失败，不影响主流程
      });
    }
  }

  // ── 内部方法 ──

  /** 格式化输出 console 日志 */
  private printConsole(
    t: TurnTrace,
    duration: number,
    spans: ReadonlyArray<SpanState>,
  ): void {
    // 按类型汇总 span 耗时
    const spanMs = new Map<string, number>();
    for (const s of spans) {
      if (s.endTime) {
        const elapsed = s.endTime - s.startTime;
        spanMs.set(s.type, (spanMs.get(s.type) ?? 0) + elapsed);
      }
    }

    const sep = '─'.repeat(60);

    console.log(`\n${sep}`);
    console.log(`  Turn  thread   : ${t.threadId}`);
    console.log(
      `  User message   : ${t.userMessage.slice(0, 80)}${t.userMessage.length > 80 ? '…' : ''}`,
    );
    console.log(`${sep}`);

    // 按 step 输出，同时关联 model call 信息
    for (const step of t.steps) {
      const mc = t.modelCalls.find((m) => m.stepIndex === step.index);

      // 模型请求摘要（从原始 request 对象中提取）
      if (mc) {
        const toolNames = mc.request.tools?.map((tool) => tool.name) ?? [];
        const tools = toolNames.length > 0 ? ` | tools: [${toolNames.join(', ')}]` : '';
        const sysLen = mc.request.system?.length ?? 0;
        console.log(
          `  [Step ${step.index}] temp=${mc.request.temperature ?? '?'} | maxTk=${mc.request.maxOutputTokens ?? '?'} | ${mc.request.messages.length} msgs | system=${sysLen}ch${tools}`,
        );
      } else {
        console.log(`  [Step ${step.index}]`);
      }

      // 模型文本响应
      if (step.text) {
        const preview =
          step.text.length > 100 ? step.text.slice(0, 100) + '…' : step.text;
        console.log(`    ↳ text : ${preview}`);
      }

      // 工具调用
      for (const tc of step.toolCalls) {
        const argsStr = JSON.stringify(tc.args);
        const argsPreview =
          argsStr.length > 80 ? argsStr.slice(0, 80) + '…' : argsStr;
        console.log(`    ↳ call : ${tc.name}(${argsPreview})`);
      }

      // 工具结果
      for (const tr of step.toolResults) {
        const icon = tr.status === 'success' ? '✓' : '✗';
        const outputStr =
          typeof tr.output === 'string' ? tr.output : JSON.stringify(tr.output);
        const outputPreview =
          outputStr.length > 80 ? outputStr.slice(0, 80) + '…' : outputStr;
        console.log(`    ↳ ${icon}    : ${tr.name} → ${outputPreview}`);
      }

      // 该步 token 用量（从原始 response 对象中提取）
      if (mc?.response?.usage) {
        console.log(
          `    ↳ usage: ${mc.response.usage.input}→${mc.response.usage.output} tokens`,
        );
      }
    }

    console.log(`${sep}`);
    const totalTokens = t.result?.usage;
    console.log(
      `  Duration: ${duration}ms  |  Steps: ${t.steps.length}  |  Tokens: ${totalTokens?.input ?? '?'}→${totalTokens?.output ?? '?'}`,
    );
    const spanSummary = [...spanMs.entries()]
      .map(([k, v]) => `${k} ${v}ms`)
      .join('  ');
    if (spanSummary) console.log(`  Spans  : ${spanSummary}`);
    console.log(`${sep}\n`);
  }
}
