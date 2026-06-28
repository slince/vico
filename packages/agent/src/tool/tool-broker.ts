// src/tool/tool-broker.ts
import type {Tool, ToolCall, ToolExecutionContext, ToolResult} from './types.js';
import {StormBreaker} from './storm-breaker.js';

/** ToolBroker — 聚合工具注册、审批策略和并行执行 */
export class ToolBroker {
  private tools: Map<string, Tool> = new Map();
  private stormBreaker: StormBreaker = new StormBreaker();

  /**
   * 批量注册工具
   * @param tools - 待注册的工具列表
   */
  registerAll(tools: Tool[]): void {
    for (const tool of tools) {
      this.tools.set(tool.name, tool);
    }
  }

  /**
   * 获取所有已注册工具
   * @returns 工具列表
   */
  list(): Tool[] {
    return Array.from(this.tools.values());
  }

  /**
   * 按名称查找工具（供 AgentLoop 检查 policy）
   * @param name - 工具名称
   * @returns 匹配的工具，未找到则返回 undefined
   */
  findTool(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  /**
   * 执行单个工具调用
   * @param call - 工具调用请求
   * @param ctx - 工具执行上下文
   * @returns 工具执行结果
   */
  async execute(call: ToolCall, ctx: ToolExecutionContext): Promise<ToolResult> {
    const tool = this.tools.get(call.name);
    if (!tool) {
      return { callId: call.id, name: call.name, status: 'error', output: null, error: `工具 ${call.name} 未找到` };
    }

    // 审批策略：_run 已处理 on-request 审批，此处只处理 never 阻断
    if (tool.policy === 'never') {
      return { callId: call.id, name: call.name, status: 'error', output: null, error: `工具 ${call.name} 被策略阻止` };
    }

    // 风暴检测
    const storm = this.stormBreaker.check(call.name, call.args);
    if (storm.blocked) {
      return { callId: call.id, name: call.name, status: 'error', output: null, error: `工具 ${call.name} 被风暴检测阻止：重复调用次数过多` };
    }

    try {
      const output = await tool.execute(call, ctx);
      this.stormBreaker.record(call.name, call.args);

      return { callId: call.id, name: call.name, status: 'success', output };
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      return { callId: call.id, name: call.name, status: 'error', output: null, error };
    }
  }

  /**
   * 批量执行工具调用，按 kind 分组调度：readonly 工具并行（每批最多 3 个），其余串行
   * @param calls - 工具调用请求列表
   * @param ctx - 工具执行上下文
   * @returns 所有工具的执行结果列表
   */
  async executeBatch(calls: ToolCall[], ctx: ToolExecutionContext): Promise<ToolResult[]> {
    if (calls.length === 0) return [];
    if (calls.length === 1) return [await this.execute(calls[0], ctx)];

    // 按 kind 分组：readonly（可并行3个）+ 其他（串行）
    const readonly: ToolCall[] = [];
    const sequential: ToolCall[] = [];

    for (const call of calls) {
      const tool = this.tools.get(call.name);
      if (tool?.kind === 'readonly') {
        readonly.push(call);
      } else {
        sequential.push(call);
      }
    }

    // 只读工具并行（最多 3 个一组）
    const results: ToolResult[] = [];
    for (let i = 0; i < readonly.length; i += 3) {
      const batch = readonly.slice(i, i + 3);
      const batchResults = await Promise.all(batch.map((c) => this.execute(c, ctx)));
      results.push(...batchResults);
    }

    // 变更工具串行
    for (const call of sequential) {
      results.push(await this.execute(call, ctx));
    }

    return results;
  }

  /**
   * 重置风暴检测器状态
   */
  resetStormBreaker(): void {
    this.stormBreaker.reset();
  }
}
