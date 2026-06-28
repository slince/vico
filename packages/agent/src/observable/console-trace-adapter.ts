// @vico/agent - ConsoleTraceAdapter: formats and prints TurnTrace to stdout
import type {TurnTrace} from './turn-tracer.js';
import type {TraceAdapter} from './trace-adapter.js';

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

      if (step.response) {
        const res = step.response;
        if (res.text) {
          const preview = res.text.length > 100 ? res.text.slice(0, 100) + '…' : res.text;
          console.log(`    ↳ text : ${preview}`);
        }

        for (const tc of res.toolCalls) {
          const argsStr = JSON.stringify(tc.args);
          const argsPreview = argsStr.length > 120 ? argsStr.slice(0, 120) + '…' : argsStr;
          console.log(`    ↳ call : ${tc.name}  id=${tc.id}  args=${argsPreview}`);
        }

        for (const tr of step.toolResults) {
          const icon = tr.status === 'success' ? '✓' : '✗';
          const outputStr = typeof tr.output === 'string' ? tr.output : JSON.stringify(tr.output);
          const outputPreview = outputStr.length > 80 ? outputStr.slice(0, 80) + '…' : outputStr;
          const errSuffix = tr.error
            ? `  error=${typeof tr.error === 'string' ? tr.error : tr.error.message}`
            : '';
          console.log(`    ↳ ${icon}    : ${tr.name}  callId=${tr.callId} → ${outputPreview}${errSuffix}`);
        }

        if (res.usage) {
          console.log(`    ↳ usage: ${res.usage.input}→${res.usage.output} tokens`);
        }
        if (res.error) {
          console.log(`    ↳ error: ${res.error}`);
        }
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
