// src/tool/child-agent-executor.ts
import type { Tool, ToolCall, ToolResult } from './types.js';
import type { ToolExecutionContext } from './types.js';
import type { DelegateStrategy, ChildAgentRef } from './types.js';
import { type AgentLoop, collectTurnResult } from '../agent-loop/agent-loop.js';
import type { ModelMessage } from '../model/types.js';


/** 子 Agent 委托执行器 */
export class ChildAgentExecutor {
  private agents: Map<string, ChildAgentRef> = new Map();

  register(agentId: string, loop: AgentLoop): void {
    this.agents.set(agentId, { agentId, loop });
  }

  unregister(agentId: string): void {
    this.agents.delete(agentId);
  }

  /** 创建委托工具 */
  createDelegateTool(agentId: string, agentName: string): Tool {
    return {
      name: `delegate_${agentId}`,
      description: `Delegate a task to the "${agentName}" agent. Use this when the user needs ${agentName}-related capabilities.`,
      inputSchema: {
        type: 'object',
        properties: {
          task: { type: 'string', description: 'The task to delegate' },
          context: { type: 'string', description: 'Additional context' },
        },
        required: ['task'],
      },
      policy: 'auto',
      kind: 'delegate',
      tags: ['delegate', `agent:${agentId}`],
      execute: async (call: ToolCall, ctx: ToolExecutionContext) => {
        const result = await this.executeDelegate(call, ctx);
        if (result.status === 'error') throw new Error(result.error);
        return result.output;
      },
    };
  }

  /** 执行委托 */
  async executeDelegate(call: ToolCall, ctx: ToolExecutionContext): Promise<ToolResult> {
    const agentId = (call.args as any).agentId ?? call.name.replace('delegate_', '');
    const ref = this.agents.get(agentId);

    if (!ref) {
      return { callId: call.id, name: call.name, status: 'error', output: null, error: `Agent ${agentId} not found` };
    }

    const task = (call.args as any).task as string;
    const context = (call.args as any).context as string | undefined;

    const userMessage: ModelMessage = {
      role: 'user',
      content: context ? `Task: ${task}\n\nContext: ${context}` : task,
    };

    try {
      const result = await collectTurnResult(ref.loop.runTurn(
        `delegate-${agentId}-${Date.now()}`,
        userMessage,
      ));

      const output = result.messages
        .filter((m) => m.role === 'assistant')
        .map((m) => m.content)
        .join('\n');

      return { callId: call.id, name: call.name, status: 'success', output };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { callId: call.id, name: call.name, status: 'error', output: null, error: message };
    }
  }
}
