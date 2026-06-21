/**
 * AgentToolFactory — 将数据库中用户定义的 Agent 转换为委托工具。
 *
 * 不再依赖 Mastra createTool() 和 agentProxy.generate()。
 * 委托执行通过 Vico ChildAgentExecutor 或直接调用子 Agent 的 AgentLoop 实现。
 */
import { z } from 'zod';
import type { Tool } from '@vico/agent';
import { agentManager } from '../../services/agent/agent-manager.js';
import type { AgentDetail } from '../../services/agent/types.js';
import { executeAgentChat } from '../../chat/chat.js';

/**
 * 为单个用户定义的 Agent 创建委托工具。
 *
 * execute 中通过 executeAgentChat 调用子 Agent。
 */
export function createAgentTool(agent: AgentDetail, tenantId: string): Tool {
  const { id, name } = agent;

  return {
    name: `agent_${id}`,
    description: `委托任务给「${name}」Agent。当用户需要 ${name} 相关能力时调用此工具`,
    inputSchema: {
      type: 'object',
      properties: {
        task: { type: 'string', description: `要委托给 ${name} 的具体任务描述` },
        context: { type: 'string', description: '附加上下文信息' },
      },
      required: ['task'],
    },
    policy: 'auto',
    kind: 'delegate',
    tags: ['agent', `agent:${id}`],
    execute: async (call) => {
      const args = call.args as { task: string; context?: string };
      let message = args.task;
      if (args.context) message = `${args.context}\n\n${args.task}`;

      const result = await executeAgentChat({
        agentId: id,
        message,
        threadId: `delegate-${id}-${Date.now()}`,
        tenantId,
        userId: '',
      });

      // 收集完整回复文本
      let fullText = '';
      while (true) {
        const { done, value } = await result.stream.next();
        if (done) break;
        if (value.type === 'text_delta') fullText += value.content;
      }
      return fullText;
    },
  };
}
