// src/tool/local-tool-host.ts
import type { ToolSpec, ToolCall, ToolResult } from './types.js';
import type { ToolHandler, ToolSource } from './types.js';
import type { ToolHost, ToolExecutionContext } from './types.js';
import { CapabilityRegistry } from './capability-registry.js';
import { resolvePolicy } from './tool-policy.js';
import { StormBreaker } from './storm-breaker.js';
import { BuiltinTools } from './builtin-tools.js';

/** LocalToolHost — 聚合多工具来源，实现审批策略和并行执行 */
export class LocalToolHost implements ToolHost {
  private registry: CapabilityRegistry = new CapabilityRegistry();
  private sources: ToolSource[] = [];
  private handlers: Map<string, ToolHandler> = new Map();
  private stormBreaker: StormBreaker = new StormBreaker();
  /** 跟踪 on-request 工具的审批状态 */
  private approvalState: Map<string, boolean> = new Map();
  /** 动态注册的 handler（优先级高于 source handler） */
  private dynamicHandlers: Map<string, ToolHandler> = new Map();

  constructor() {
    this.addBuiltinSource();
  }

  /** 注册工具来源 */
  addSource(source: ToolSource): void {
    this.sources.push(source);
  }

  async listTools(ctx: ToolExecutionContext): Promise<ToolSpec[]> {
    // 聚合所有来源
    const all: ToolSpec[] = [];
    for (const source of this.sources) {
      const tools = await source.list(ctx);
      for (const tool of tools) {
        this.registry.register(tool, [source.name]);
        this.handlers.set(tool.name, source.getHandler(tool.name) ?? {
          execute: async () => `Tool ${tool.name}: no handler registered`,
        });
      }
      all.push(...tools);
    }
    return all;
  }

  async execute(call: ToolCall, ctx: ToolExecutionContext): Promise<ToolResult> {
    const tool = this.registry.get(call.name);
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
      const handler = this.dynamicHandlers.get(call.name) ?? this.handlers.get(call.name);
      if (!handler) {
        return { callId: call.id, name: call.name, status: 'error', output: null, error: `No handler for ${call.name}` };
      }

      // PreToolUse hook
      if (ctx.hooks.length > 0) {
        for (const hook of ctx.hooks) {
          const result = await hook.run({ call });
          if (result.action === 'deny') {
            return { callId: call.id, name: call.name, status: 'error', output: null, error: result.message ?? 'Denied by hook' };
          }
        }
      }

      const output = await handler.execute(call, ctx);
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
      const tool = this.registry.get(call.name);
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

  private addBuiltinSource(): void {
    this.addSource({
      name: 'builtin',
      list: async () => BuiltinTools.list(),
      getHandler: (name: string): ToolHandler => {
        const handlers: Record<string, ToolHandler> = {
          echo: { execute: async (call) => (call.args as any).message ?? '' },
          now: { execute: async () => new Date().toISOString() },
        };
        return handlers[name] ?? { execute: async () => `No handler for builtin:${name}` };
      },
    });
  }

  /** 动态注册工具处理器（覆盖已有同名 handler） */
  registerHandler(name: string, handler: ToolHandler): void {
    this.dynamicHandlers.set(name, handler);
  }

  /** 暴露 storm breaker 供外部重置 */
  resetStormBreaker(): void {
    this.stormBreaker.reset();
  }
}
