// @vico/agent - ToolExecutor: 工具注册、审批策略和并行执行
import type {Logger} from 'pino';
import type {Tool, ToolCall, ToolCallContext, ToolResult} from '../tool/types.js';
import {StormBreaker} from '../tool/storm-breaker.js';
import type {ModelMessage} from '../model/types.js';
import type {CheckpointStore} from './checkpoint.js';
import type {TokenEconomy} from './token-economy.js';
import type {TurnContext} from './agent-loop-options.js';
import type {TurnEvent} from './types.js';

/** ToolExecutor 构造选项 */
export interface ToolExecutorOptions {
  tools?: Tool[];
  checkpointStore: CheckpointStore;
  emit: (event: TurnEvent) => void;
  persistMessage: (message: ModelMessage, context: TurnContext) => Promise<void>;
  logger: Logger;
  tokenEconomy?: TokenEconomy;
}

/** ToolExecutor — 工具注册、执行、结果持久化 */
export class ToolExecutor {
  private tools: Map<string, Tool> = new Map();
  private stormBreaker: StormBreaker = new StormBreaker();
  private checkpointStore: CheckpointStore;
  private emit: (event: TurnEvent) => void;
  private persistMessage: (message: ModelMessage, context: TurnContext) => Promise<void>;
  private log: Logger;
  private tokenEconomy?: TokenEconomy;

  constructor(options: ToolExecutorOptions) {
    this.checkpointStore = options.checkpointStore;
    this.emit = options.emit;
    this.persistMessage = options.persistMessage;
    this.log = options.logger;
    this.tokenEconomy = options.tokenEconomy;

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

    this.log.info({ turnId: context.session.turn.id, count: toolCalls.length, names: toolCalls.map(c => c.name) }, 'executing tool calls');

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

    let latestCheckpoint = await this.checkpointStore.getByTurn(turnId);

    const executeAndPersist = async (call: ToolCall): Promise<ToolResult> => {
      latestCheckpoint = await this.checkpointStore.save(turnId, threadId, {
        pendingToolCall: { id: call.id, name: call.name, args: call.args as Record<string, unknown> },
      });

      const result = await this.execute(call, toolCallContext);

      const prevIds = latestCheckpoint?.completedToolCallIds ?? [];
      const prevResults = latestCheckpoint?.completedToolResults ?? [];
      latestCheckpoint = await this.checkpointStore.save(turnId, threadId, {
        stepIndex: latestCheckpoint?.stepIndex ?? 0,
        completedToolCallIds: [...prevIds, call.id],
        completedToolResults: [...prevResults, result],
        pendingToolCall: null,
      });

      const content = result.status === 'success'
        ? (typeof result.output === 'string' ? result.output : JSON.stringify(result.output))
        : (result.error instanceof Error ? result.error.message : (result.error ?? 'tool execution failed'));

      const message: ModelMessage = { role: 'tool', content, toolCallId: result.callId };
      context.messages.push(message);
      await this.persistMessage(message, context);
      this.emit({ type: 'tool-result', id: result.callId, name: result.name, status: result.status, output: result.output });
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
