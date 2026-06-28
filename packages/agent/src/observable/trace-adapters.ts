// @vico/agent - TraceAdapter: persistence layer for TurnTrace output
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { homedir } from 'node:os';
import type { TurnTrace, TraceLevel } from './loop-tracer.js';

// ── 适配器接口 ──

/** Trace 持久化适配器 — 负责将 trace 输出到目标 */
export interface TraceAdapter {
  write(trace: TurnTrace): void | Promise<void>;
}

// ── Console 适配器 ──

/** 默认 trace 文件导出目录 */
export const DEFAULT_TRACE_DIR = path.join(homedir(), '.vico', 'traces');

/** Console 输出适配器 — 格式化 trace 并打印到 stdout */
export class ConsoleTraceAdapter implements TraceAdapter {
  write(trace: TurnTrace): void {
    const duration = (trace.endTime ?? Date.now()) - trace.startTime;

    // 按类型汇总 span 耗时
    const spanMs = new Map<string, number>();
    for (const s of trace.spans) {
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
      if (step.request) {
        const req = step.request;
        console.log(`  ┌─[Step ${step.index}]──────────────────────────────────────────────`);
        console.log(`  │ temp: ${req.temperature ?? '?'}  maxTk: ${req.maxOutputTokens ?? '?'}  messages: ${req.messages.length}  tools: ${req.tools?.length ?? 0}`);

        // system prompt
        if (req.system) {
          const sysPreview = req.system.length > 120 ? req.system.slice(0, 120) + '…' : req.system;
          console.log(`  │ system: ${sysPreview}`);
        }

        // messages
        for (const msg of req.messages) {
          const role = (msg.role ?? '?').padEnd(10);
          const content = typeof msg.content === 'string'
            ? msg.content
            : JSON.stringify(msg.content);
          const preview = content.length > 100 ? content.slice(0, 100) + '…' : content;
          const extras: string[] = [];
          if ('toolCallId' in msg && msg.toolCallId) extras.push(`toolCallId=${msg.toolCallId}`);
          if ('toolCalls' in msg && (msg as any).toolCalls?.length) {
            extras.push(`toolCalls=${(msg as any).toolCalls.map((t: any) => t.name ?? t.toolName).join(',')}`);
          }
          const extra = extras.length > 0 ? `  (${extras.join(', ')})` : '';
          console.log(`  │   ${role}: ${preview}${extra}`);
        }

        // tools
        if (req.tools?.length) {
          for (const t of req.tools) {
            console.log(`  │   tool: ${t.name} — ${t.description?.slice(0, 60) ?? '-'}`);
          }
        }
        console.log(`  └──────────────────────────────────────────────────────────────`);
      } else {
        console.log(`  [Step ${step.index}] (no request data)`);
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

      if (step.response?.usage) {
        console.log(`    ↳ usage: ${step.response.usage.input}→${step.response.usage.output} tokens`);
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

// ── 文件适配器 ──

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

  async write(trace: TurnTrace): Promise<void> {
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
          request: s.request,
          response: s.response,
        })),
        spans: trace.spans.map((s) => ({
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

// ── 工厂 ──

/**
 * 根据 TraceLevel 创建默认适配器列表。
 * @param level - 追踪级别，0=关闭，1=console，2=console+文件
 * @returns TraceAdapter 数组
 */
export function createAdaptersFromLevel(level: TraceLevel): TraceAdapter[] {
  const adapters: TraceAdapter[] = [];
  if (level >= 1) adapters.push(new ConsoleTraceAdapter());
  if (level >= 2) adapters.push(new FileTraceAdapter());
  return adapters;
}
