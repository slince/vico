// src/tool/tool-broker.ts
import type {Tool, ToolCall, ToolExecutionContext, ToolResult, ToolSource} from './types.js';
import {resolvePolicy} from './tool-policy.js';
import {StormBreaker} from './storm-breaker.js';

/** ToolBroker — 聚合多工具来源，实现审批策略和并行执行 */
export class ToolBroker {
  private tools: Map<string, Tool> = new Map();
  private sources: ToolSource[] = [];
  private stormBreaker: StormBreaker = new StormBreaker();
  /** 跟踪 on-request 工具的审批状态 */
  private approvalState: Map<string, boolean> = new Map();

  /** 注册工具来源 */
  addSource(source: ToolSource): void {
    this.sources.push(source);
  }

  async listTools(ctx: ToolExecutionContext): Promise<Tool[]> {
    const all: Tool[] = [];
    for (const source of this.sources) {
      const tools = await source.list(ctx);
      for (const tool of tools) {
        this.tools.set(tool.name, tool);
      }
      all.push(...tools);
    }
    return all;
  }

  async execute(call: ToolCall, ctx: ToolExecutionContext): Promise<ToolResult> {
    const tool = this.tools.get(call.name);
    if (!tool) {
      return { callId: call.id, name: call.name, status: 'error', output: null, error: `Tool ${call.name} not found` };
    }

    // 审批策略
    const firstUse = !this.approvalState.has(call.name);
    const previousApproved = this.approvalState.get(call.name) ?? false;
    const decision = resolvePolicy(tool.policy, call, { firstUse, previousApproved });

    if (!decision.approved) {
      // on-request: 需要外部审批
      if (tool.policy === 'on-request') {
        const approval = await ctx.awaitApproval(call);
        if (!approval.approved) {
          return { callId: call.id, name: call.name, status: 'error', output: null, error: approval.reason ?? 'User denied' };
        }
        this.approvalState.set(call.name, true);
      } else {
        return { callId: call.id, name: call.name, status: 'error', output: null, error: decision.reason ?? 'Blocked by policy' };
      }
    }

    // 风暴检测
    const storm = this.stormBreaker.check(call.name, call.args);
    if (storm.blocked) {
      return { callId: call.id, name: call.name, status: 'error', output: null, error: `Tool ${call.name} blocked by storm breaker: too many repeated calls` };
    }

    try {
      const output = await tool.execute(call, ctx);
      this.stormBreaker.record(call.name, call.args);

      return { callId: call.id, name: call.name, status: 'success', output };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { callId: call.id, name: call.name, status: 'error', output: null, error: message };
    }
  }

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

  /** 暴露 storm breaker 供外部重置 */
  resetStormBreaker(): void {
    this.stormBreaker.reset();
  }
}
