// @vico/core - ToolExecutor: 工具注册、执行、checkpoint 追踪
import type {Logger} from 'pino';
import type {Tool, ToolCall, ToolCallContext, ToolResult} from '../tool/types.js';
import {StormBreaker} from '../tool/storm-breaker.js';
import type { ModelMessage } from 'ai';
import type {CheckpointStore} from './checkpoint.js';
import type {TokenEconomy} from './token-economy.js';
import type {TurnContext} from './agent-loop-options.js';
import type {TurnEvent} from './types.js';
import {toolResultPart} from './stream-parts.js';

/** AgentLoop 暴露给 ToolExecutor 的方法和属性 */
export interface ToolExecutorHost {
  emit(event: TurnEvent): void;
  persistMessage(message: ModelMessage, context: TurnContext): Promise<void>;
  resolveToolResult(r: ToolResult): string;
  appendToolResults(toolResults: ToolResult[], context: TurnContext): Promise<void>;
  checkpointStore: CheckpointStore;
  log: Logger;
  tokenEconomy?: TokenEconomy;
}

/** ToolExecutor 构造选项 */
export interface ToolExecutorOptions {
  tools?: Tool[];
  host: ToolExecutorHost;
}

/** ToolExecutor — 工具注册、执行、结果持久化 */
export class ToolExecutor {
  private tools: Map<string, Tool> = new Map();
  private stormBreaker: StormBreaker = new StormBreaker();
  private host: ToolExecutorHost;

  constructor(options: ToolExecutorOptions) {
    this.host = options.host;
    for (const tool of options.tools ?? []) {
      this.tools.set(tool.name, tool);
    }
  }

  /** 获取所有已注册工具 */
  list(): Tool[] {
    return Array.from(this.tools.values());
  }

  /** 按名称查找工具 */
  findTool(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  /** 执行单个工具调用 */
  async execute(call: ToolCall, ctx: ToolCallContext): Promise<ToolResult> {
    const tool = this.tools.get(call.name);
    if (!tool) {
      return { callId: call.id, name: call.name, status: 'error', output: null, error: `工具 ${call.name} 未找到` };
    }

    if (tool.policy === 'never') {
      return { callId: call.id, name: call.name, status: 'error', output: null, error: `工具 ${call.name} 被策略阻止` };
    }

    const storm = this.stormBreaker.check(call.name, call.args);
    if (storm.blocked) {
      return { callId: call.id, name: call.name, status: 'error', output: null, error: `工具 ${call.name} 被风暴检测阻止：重复调用次数过多` };
    }

    try {
      const output = await tool.execute(call, ctx);
      this.stormBreaker.record(call.name, call.args);
      return { callId: call.id, name: call.name, status: 'success', output };
    } catch (err) {
      const error = err instanceof Error ? err : String(err);
      return { callId: call.id, name: call.name, status: 'error', output: null, error };
    }
  }

  /**
   * 执行工具调用，逐条持久化 + checkpoint 追踪。
   * readonly 并行，其余串行。
   */
  async executeToolCalls(toolCalls: ToolCall[], context: TurnContext): Promise<ToolResult[]> {
    if (toolCalls.length === 0) return [];

    this.host.log.info({ turnId: context.session.turn.id, count: toolCalls.length, names: toolCalls.map(c => c.name) }, 'executing tool calls');

    const toolSpan = context.trace.startSpan('tool_call', { count: toolCalls.length });
    const toolCallContext: ToolCallContext = { session: context.session, signal: context.signal };
    const turnId = context.session.turn.id;
    const threadId = context.session.thread.id;

    const readonlyCalls: ToolCall[] = [];
    const sequentialCalls: ToolCall[] = [];
    for (const call of toolCalls) {
      const tool = this.findTool(call.name);
      if (tool?.kind === 'readonly') {
        readonlyCalls.push(call);
      } else {
        sequentialCalls.push(call);
      }
    }

    let latestCheckpoint = await this.host.checkpointStore.getByTurn(turnId);

    const executeAndPersist = async (call: ToolCall): Promise<ToolResult> => {
      latestCheckpoint = await this.host.checkpointStore.save(turnId, threadId, {pendingToolCall: call});

      const result = await this.execute(call, toolCallContext);

      const prevIds = latestCheckpoint?.completedToolCallIds ?? [];
      const prevResults = latestCheckpoint?.completedToolResults ?? [];
      latestCheckpoint = await this.host.checkpointStore.save(turnId, threadId, {
        stepIndex: latestCheckpoint?.stepIndex ?? 0,
        completedToolCallIds: [...prevIds, call.id],
        completedToolResults: [...prevResults, result],
        pendingToolCall: null,
      });

      await this.host.appendToolResults([result], context);
      // 工具执行结果上流：success → tool-result part，error → tool-error part
      context.controller.enqueue(toolResultPart(result, call.args));
      this.host.emit({ type: 'tool-result', id: result.callId, name: result.name, status: result.status, output: result.output });
      return result;
    };

    const results: ToolResult[] = [];

    const readonlyResults = await Promise.all(readonlyCalls.map(executeAndPersist));
    results.push(...readonlyResults);

    for (const call of sequentialCalls) {
      results.push(await executeAndPersist(call));
    }

    toolSpan.end({ results: results.length });
    return results;
  }
}
