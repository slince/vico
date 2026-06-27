// @vico/agent - TraceExporter: dumps TurnTrace to JSON file for offline analysis
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import {homedir} from 'node:os';
import type {TurnTrace} from './loop-tracer.js';
import type {SpanState} from './types.js';

/** Trace 文件导出器 — 将 turn 追踪数据 dump 为 JSON 文件 */
export class TraceExporter {
  private static baseDir = path.join(homedir(), '.vico', 'traces');

  /** 自定义导出目录 */
  static setBaseDir(dir: string): void {
    this.baseDir = dir;
  }

  /** 导出 turn trace 和 spans 到 JSON 文件 */
  static async dump(trace: TurnTrace, spans: ReadonlyArray<SpanState>): Promise<void> {
    try {
      const dateDir = new Date().toISOString().slice(0, 10);
      const dir = path.join(this.baseDir, dateDir);
      await fs.mkdir(dir, {recursive: true});

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
          ? {
              status: trace.result.status,
              steps: trace.result.steps,
              usage: trace.result.usage,
            }
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
