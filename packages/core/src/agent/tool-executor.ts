// @vico/core - ToolExecutor: 工具注册、执行、结果上流
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

/** ToolExecutor — 工具注册、执行、结果上流 */
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
   * 执行工具调用，逐条上流结果。
   * readonly 并行执行（无副作用），其余串行逐条执行。
   * 工具结果只落消息链（由调用方 appendToolResults 持久化），本方法不写 checkpoint。
   */
  async executeToolCalls(toolCalls: ToolCall[], context: TurnContext<TToolSet>): Promise<ToolResult[]> {
    if (toolCalls.length === 0) return [];

    const toolCallContext: ToolCallContext = { session: context.session, signal: context.signal };

    const { readonlyCalls, sequentialCalls } = this.partitionCalls(toolCalls);

    const results: ToolResult[] = [];

    // 工具执行结果上流：success → tool-result part，error → tool-error part
    const emitResult = (call: ToolCall, result: ToolResult): void => {
      context.controller.enqueue(toolResultPart(result, call.args));
      this.host.emit({ type: 'tool-result', id: result.callId, name: result.name, status: result.status, output: result.output });
    };

    // readonly：并行执行（无副作用），结果串行上流
    const executed = await Promise.all(
      readonlyCalls.map(async (call) => ({ call, result: await this.execute(call, toolCallContext) })),
    );
    for (const { call, result } of executed) {
      emitResult(call, result);
      results.push(result);
    }

    // sequential：串行逐条执行（mutation 有副作用，串行避免并发干扰）
    for (const call of sequentialCalls) {
      const result = await this.execute(call, toolCallContext);
      emitResult(call, result);
      results.push(result);
    }

    return results;
  }
}
