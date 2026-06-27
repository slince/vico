// @vico/agent - LoopTracer: subscribes to AgentLoop events + spans, outputs structured trace on turn end
import type {EventRecorder} from '../events/types.js';
import type {TurnEvent, TurnResult} from '../agent-loop/types.js';
import type {CallModelResult} from '../agent-loop/agent-loop.js';
import type {ModelRequest} from '../model/types.js';
import type {SpanTracker} from './types.js';
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
 * LoopTracer — 订阅 AgentLoop 的 TurnEvent 事件流，结合 SpanTracker 的计时数据，
 * 在 turn 结束时输出结构化追踪日志，方便排查 Agent 执行过程。
 *
 * level: 0 = 不追踪（无开销）；1 = console 输出；2 = console + JSON 文件导出
 */
export class LoopTracer {
  private currentTrace?: TurnTrace;
  private currentStep?: StepTrace;
  /** 当前 step 的 model call 引用，流结束后填充 response */
  private pendingModelCalls = new Map<number, ModelCallTrace>();

  constructor(
    private readonly events: EventRecorder<TurnEvent>,
    private readonly spanTracker: SpanTracker,
    private readonly level: TraceLevel = 0,
  ) {
    if (level > 0) {
      this.subscribe();
    }
  }

  // ── 公开方法（AgentLoop 调用）──

  /** 开始追踪一个 turn */
  startTurn(threadId: string, userMessage: string): void {
    if (this.level === 0) return;
    this.spanTracker.clear();
    this.pendingModelCalls.clear();
    this.currentTrace = {
      threadId,
      userMessage,
      startTime: Date.now(),
      steps: [],
      modelCalls: [],
      events: [],
    };
  }

  /** 记录 LLM 请求参数。接收原始 ModelRequest，调用方直接传入即可 */
  recordModelRequest(stepIndex: number, request: ModelRequest): void {
    if (!this.currentTrace) return;
    const entry: ModelCallTrace = { stepIndex, request };
    this.pendingModelCalls.set(stepIndex, entry);
    this.currentTrace.modelCalls.push(entry);
  }

  /** 记录 LLM 响应结果。接收原始 CallModelResult，调用方直接传入即可 */
  recordModelResponse(stepIndex: number, response: CallModelResult): void {
    const entry = this.pendingModelCalls.get(stepIndex);
    if (entry) {
      entry.response = response;
      this.pendingModelCalls.delete(stepIndex);
    }
  }

  /** 结束 turn，输出追踪结果 */
  endTurn(result: TurnResult): void {
    if (!this.currentTrace) return;
    this.currentTrace.endTime = Date.now();
    this.currentTrace.result = result;

    const duration = this.currentTrace.endTime - this.currentTrace.startTime;
    const spans = this.spanTracker.getAllSpans();

    if (this.level >= 1) {
      this.printConsole(duration, spans);
    }

    if (this.level >= 2) {
      TraceExporter.dump(this.currentTrace, spans).catch(() => {
        // 静默失败，不影响主流程
      });
    }

    this.currentTrace = undefined;
  }

  // ── 内部方法 ──

  /** 订阅所有 TurnEvent，按 type 分流收集 */
  private subscribe(): void {
    this.events.on('*', (event) => {
      if (!this.currentTrace) return;
      this.currentTrace.events.push(event);

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
            this.currentTrace.steps.push(this.currentStep);
            this.currentStep = undefined;
          }
          break;
      }
    });
  }

  /** 格式化输出 console 日志 */
  private printConsole(
    duration: number,
    spans: ReadonlyArray<{
      type: string;
      startTime: number;
      endTime?: number;
      error?: string;
      result?: Record<string, unknown>;
    }>,
  ): void {
    const t = this.currentTrace!;

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
        const toolNames = mc.request.tools?.map((t) => t.name) ?? [];
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
