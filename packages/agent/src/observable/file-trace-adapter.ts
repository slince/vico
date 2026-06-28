// @vico/agent - FileTraceAdapter: serializes TurnTrace to JSON file
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import {homedir} from 'node:os';
import type {TurnTrace} from './loop-tracer.js';
import type {TraceAdapter} from './trace-adapter';

/** 默认 trace 文件导出目录 */
export const DEFAULT_TRACE_DIR = path.join(homedir(), '.vico', 'traces');

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
