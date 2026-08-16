// @vico/core - ToolExecutor: 工具注册、执行、checkpoint 追踪
import type {Tool, ToolCall, ToolCallContext, ToolResult} from '../tool/types.js';
import {StormBreaker} from '../tool/storm-breaker.js';
import type {ToolSet} from 'ai';
import type {LoopAgent} from './loop-agent.js';
import type {TurnContext} from './loop-agent-options.js';
import {toolResultPart} from './stream-parts.js';

/** ToolExecutor 构造选项 */
export interface ToolExecutorOptions<TToolSet extends ToolSet = ToolSet> {
  tools?: Tool[];
  host: LoopAgent<TToolSet>;
}

/** ToolExecutor — 工具注册、执行、结果持久化 */
export class ToolExecutor<TToolSet extends ToolSet = ToolSet> {
  private tools: Map<string, Tool> = new Map();
  private stormBreaker: StormBreaker = new StormBreaker();
  private host: LoopAgent<TToolSet>;

  constructor(options: ToolExecutorOptions<TToolSet>) {
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

  /**
   * 按工具 kind 分组：readonly 可并行执行，其余需串行。
   *
   * @param toolCalls - 待分组的工具调用列表
   * @returns readonly 与串行两组调用
   */
  private partitionCalls(toolCalls: ToolCall[]): {
    readonlyCalls: ToolCall[];
    sequentialCalls: ToolCall[];
  } {
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
    return { readonlyCalls, sequentialCalls };
  }

  /** 执行单个工具调用 */
  private async execute(call: ToolCall, ctx: ToolCallContext): Promise<ToolResult> {
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
   * readonly 并行执行（无副作用）后串行持久化，其余串行逐条持久化。
   */
  async executeToolCalls(toolCalls: ToolCall[], context: TurnContext<TToolSet>): Promise<ToolResult[]> {
    if (toolCalls.length === 0) return [];

    const toolCallContext: ToolCallContext = { session: context.session, signal: context.signal };
    const checkpoint = context.checkpoint;
    const store = this.host.checkpointStore;

    const { readonlyCalls, sequentialCalls } = this.partitionCalls(toolCalls);

    const results: ToolResult[] = [];

    // 工具执行结果上流：success → tool-result part，error → tool-error part
    const persistResult = async (call: ToolCall, result: ToolResult): Promise<void> => {
      await this.host.appendToolResults([result], context);
      context.controller.enqueue(toolResultPart(result, call.args));
      this.host.emit({ type: 'tool-result', id: result.callId, name: result.name, status: result.status, output: result.output });
    };

    // readonly：并行执行（无副作用、不写 pending），结果追加与持久化串行化以规避 completedToolResults 覆盖竞态
    const executed = await Promise.all(
      readonlyCalls.map(async (call) => ({ call, result: await this.execute(call, toolCallContext) })),
    );
    for (const { call, result } of executed) {
      checkpoint.completedToolResults.push(result);
      await store.update(checkpoint);
      await persistResult(call, result);
      results.push(result);
    }

    // sequential：串行逐条执行，执行前写 pending 保证崩溃后重试（mutation 有副作用，需逐条持久化）
    for (const call of sequentialCalls) {
      checkpoint.pendingToolCall = call;
      await store.update(checkpoint);
      const result = await this.execute(call, toolCallContext);
      checkpoint.completedToolResults.push(result);
      checkpoint.pendingToolCall = null;
      await store.update(checkpoint);
      await persistResult(call, result);
      results.push(result);
    }

    return results;
  }
}
