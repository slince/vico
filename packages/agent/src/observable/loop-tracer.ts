// @vico/agent - LoopTracer: subscribes to AgentLoop events, collects spans, outputs structured trace on turn end
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { homedir } from 'node:os';
import type { EventRecorder } from '../events/types.js';
import type { Step, TurnEvent, TurnResult } from '../agent-loop/types.js';
import type { CallModelResult } from '../agent-loop/agent-loop.js';
import type { ModelRequest, ModelMessage } from '../model/types.js';
import type { Thread } from '../thread/types.js';
import type { Span, SpanState, SpanType } from './types.js';

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

// ── 持久化适配器 ──

/** Trace 持久化适配器 — 负责将 trace + spans 输出到目标 */
export interface TraceAdapter {
  write(trace: TurnTrace, spans: ReadonlyArray<SpanState>): void | Promise<void>;
}

/** 默认 trace 文件导出目录 */
export const DEFAULT_TRACE_DIR = path.join(homedir(), '.vico', 'traces');

/** Console 输出适配器 — 格式化 trace 并打印到 stdout */
export class ConsoleTraceAdapter implements TraceAdapter {
  write(trace: TurnTrace, spans: ReadonlyArray<SpanState>): void {
    const duration = (trace.endTime ?? Date.now()) - trace.startTime;

    // 按类型汇总 span 耗时
    const spanMs = new Map<string, number>();
    for (const s of spans) {
      if (s.endTime) {
        spanMs.set(s.type, (spanMs.get(s.type) ?? 0) + s.endTime - s.startTime);
      }
    }

    const sep = '─'.repeat(60);

    console.log(`\n${sep}`);
    console.log(`  Turn  thread   : ${trace.threadId}`);
    console.log(
      `  User message   : ${trace.userMessage.slice(0, 80)}${trace.userMessage.length > 80 ? '…' : ''}`,
    );
    console.log(`${sep}`);

    for (const step of trace.steps) {
      const mc = trace.modelCalls.find((m) => m.stepIndex === step.index);

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

      if (step.text) {
        const preview = step.text.length > 100 ? step.text.slice(0, 100) + '…' : step.text;
        console.log(`    ↳ text : ${preview}`);
      }

      for (const tc of step.toolCalls) {
        const argsStr = JSON.stringify(tc.args);
        const argsPreview = argsStr.length > 80 ? argsStr.slice(0, 80) + '…' : argsStr;
        console.log(`    ↳ call : ${tc.name}(${argsPreview})`);
      }

      for (const tr of step.toolResults) {
        const icon = tr.status === 'success' ? '✓' : '✗';
        const outputStr = typeof tr.output === 'string' ? tr.output : JSON.stringify(tr.output);
        const outputPreview = outputStr.length > 80 ? outputStr.slice(0, 80) + '…' : outputStr;
        console.log(`    ↳ ${icon}    : ${tr.name} → ${outputPreview}`);
      }

      if (mc?.response?.usage) {
        console.log(`    ↳ usage: ${mc.response.usage.input}→${mc.response.usage.output} tokens`);
      }
    }

    console.log(`${sep}`);
    const totalTokens = trace.result?.usage;
    console.log(
      `  Duration: ${duration}ms  |  Steps: ${trace.steps.length}  |  Tokens: ${totalTokens?.input ?? '?'}→${totalTokens?.output ?? '?'}`,
    );
    const spanSummary = [...spanMs.entries()].map(([k, v]) => `${k} ${v}ms`).join('  ');
    if (spanSummary) console.log(`  Spans  : ${spanSummary}`);
    console.log(`${sep}\n`);
  }
}

/** FileTraceAdapter 选项 */
export interface FileTraceAdapterOptions {
  /** 文件导出主目录，默认 ~/.vico/traces */
  baseDir?: string;
}

/** 文件导出适配器 — 将 trace 序列化为 JSON 文件 */
export class FileTraceAdapter implements TraceAdapter {
  private baseDir: string;

  constructor(options: FileTraceAdapterOptions = {}) {
    this.baseDir = options.baseDir ?? DEFAULT_TRACE_DIR;
  }

  async write(trace: TurnTrace, spans: ReadonlyArray<SpanState>): Promise<void> {
    try {
      const dateDir = new Date().toISOString().slice(0, 10);
      const dir = path.join(this.baseDir, dateDir);
      await fs.mkdir(dir, { recursive: true });

      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `turn-${trace.threadId.slice(0, 8)}-${ts}.json`;
      const filepath = path.join(dir, filename);

      const payload = {
        threadId: trace.threadId,
        userMessage: trace.userMessage,
        duration: trace.endTime ? trace.endTime - trace.startTime : 0,
        startTime: new Date(trace.startTime).toISOString(),
        endTime: trace.endTime ? new Date(trace.endTime).toISOString() : undefined,
        steps: trace.steps.map((s) => ({
          index: s.index,
          text: s.text,
          toolCalls: s.toolCalls,
          toolResults: s.toolResults,
        })),
        modelCalls: trace.modelCalls.map((mc) => ({
          stepIndex: mc.stepIndex,
          request: mc.request,
          response: mc.response ?? undefined,
        })),
        spans: spans.map((s) => ({
          id: s.id,
          type: s.type,
          metadata: s.metadata,
          duration: s.endTime ? s.endTime - s.startTime : undefined,
          error: s.error,
          result: s.result,
        })),
        result: trace.result
          ? { status: trace.result.status, steps: trace.result.steps, usage: trace.result.usage }
          : undefined,
        exportedAt: new Date().toISOString(),
      };

      await fs.writeFile(filepath, JSON.stringify(payload, null, 2), 'utf-8');
      console.log(`[LoopTracer] Trace dumped → ${filepath}`);
    } catch (err) {
      console.warn(
        '[LoopTracer] Failed to dump trace:',
        err instanceof Error ? err.message : String(err),
      );
    }
  }
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

  /** 启动一个追踪 Span */
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

  /** 获取本次会话内所有 span */
  getAllSpans(): ReadonlyArray<SpanState> {
    return this.spans;
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

  /** 为当前 turn 创建独立的追踪会话 */
  startTurn(thread: Thread, userMessage: ModelMessage): TurnTraceSession {
    return new TurnTraceSession(thread, userMessage, this.events);
  }

  /** 结束 turn：从 session 提取数据，委托所有适配器输出/导出 */
  async finish(traceSession: TurnTraceSession, result: TurnResult): Promise<void> {
    const trace = traceSession.finalize(result);
    const spans = traceSession.getAllSpans();

    for (const adapter of this.adapters) {
      try {
        await adapter.write(trace, spans);
      } catch {
        // 适配器失败不影响主流程
      }
    }
  }
}

/** 根据 TraceLevel 创建默认适配器列表 */
export function createAdaptersFromLevel(level: TraceLevel): TraceAdapter[] {
  const adapters: TraceAdapter[] = [];
  if (level >= 1) adapters.push(new ConsoleTraceAdapter());
  if (level >= 2) adapters.push(new FileTraceAdapter());
  return adapters;
}
