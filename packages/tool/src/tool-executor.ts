// @vico/tool - ToolExecutor: 工具注册与执行

import type { Tool, ToolCall, ToolCallContext, ToolResult } from './types.js';
import { StormBreaker } from './storm-breaker.js';
import type { TurnSession } from '@vico/thread';
import type { ToolCallApproval } from '@vico/types';

/** ToolExecutor 执行工具所需的最小上下文（依赖倒置：引擎的 TurnContext 满足此结构） */
export interface ToolExecutionContext {
  session: TurnSession;
  signal: AbortSignal;
  decisions: Map<string, ToolCallApproval>;
}

/** ToolExecutor 构造选项 */
export interface ToolExecutorOptions {
  tools?: Tool[];
}

/** ToolExecutor — 工具注册与执行 */
export class ToolExecutor {
  private tools: Map<string, Tool> = new Map();
  private stormBreaker: StormBreaker = new StormBreaker();

  constructor(options: ToolExecutorOptions) {
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
  private async execute(call: ToolCall, context: ToolExecutionContext): Promise<ToolResult> {
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

    // 逐 call 构建上下文：注入本 call 对应的审批决策（resume 恢复时才有），澄清类工具从中读取用户回答
    const ctx: ToolCallContext = {
      session: context.session,
      signal: context.signal,
      approval: context.decisions.get(call.id),
    };

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
   * 执行工具调用并返回结果列表。每个结果完成时经 onResult 回调通知调用方，
   * 由调用方负责上流（转流 part / 事件），本模块不依赖流协议。
   * readonly 并行执行（无副作用），其余串行逐条执行。
   * 工具结果只落消息链（由调用方 appendToolResults 持久化），本方法不写 checkpoint。
   *
   * @param toolCalls - 待执行的工具调用列表
   * @param context - 工具执行上下文（会话、信号、审批决策）
   * @param onResult - 单个工具结果完成时的回调（含调用与结果），可选
   * @returns 全部执行结果（与 toolCalls 一一对应）
   */
  async executeToolCalls(
    toolCalls: ToolCall[],
    context: ToolExecutionContext,
    onResult?: (call: ToolCall, result: ToolResult) => void,
  ): Promise<ToolResult[]> {
    if (toolCalls.length === 0) return [];

    const { readonlyCalls, sequentialCalls } = this.partitionCalls(toolCalls);

    const results: ToolResult[] = [];

    // readonly：并行执行（无副作用），结果串行回调
    const executed = await Promise.all(
      readonlyCalls.map(async (call) => ({ call, result: await this.execute(call, context) })),
    );
    for (const { call, result } of executed) {
      onResult?.(call, result);
      results.push(result);
    }

    // sequential：串行逐条执行（mutation 有副作用，串行避免并发干扰）
    for (const call of sequentialCalls) {
      const result = await this.execute(call, context);
      onResult?.(call, result);
      results.push(result);
    }

    return results;
  }
}
