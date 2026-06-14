/**
 * AgentToolFactory — 将数据库中用户定义的 Agent 转换为 Mastra Tool。
 *
 * 每个工具代表一个"委托给专业 Agent"的操作。当 Mastra vicoMain Agent
 * 调用该工具时，execute 内部通过 agentManager.getAgentRuntimeConfig()
 * 一次性解析所有运行时配置，注入 requestContext，再由 agentProxy
 * 同步读取。
 */
import { createTool } from '@mastra/core/tools';
import { RequestContext } from '@mastra/core/request-context';
import { z } from 'zod';
import { agentProxy } from '../agents/agent-proxy.agent.js';
import { agentManager } from '../../services/agent/agent-manager.js';
import { buildAgentTools } from './agent-tools.factory.js';
import { AgentDetail } from '../../services/agent/types.js';

/**
 * 为单个用户定义的 Agent 创建 Mastra Tool。
 *
 * 返回的 Tool 可被 vicoMainAgent 作为子 Agent 工具调用。
 * execute 中通过 agentManager.getAgentRuntimeConfig() 一次性解析
 * 所有运行时配置（模型、指令），注入 requestContext 供 agentProxy 同步读取。
 *
 * 每个调用使用独立的 memory thread，确保不同委托之间上下文隔离。
 *
 * @param agent - 来自 agents 表的 Agent 配置行，tenant_id 由此提取
 * @returns Mastra Tool 实例
 */
export function createAgentTool(agent: AgentDetail) {
  const { id, name, tenant_id } = agent;

  return createTool({
    id: `agent_${id}`,
    description: `委托任务给「${name}」Agent。当用户需要 ${name} 相关能力时调用此工具`,
    inputSchema: z.object({
      task: z.string().describe(`要委托给 ${name} 的具体任务描述`),
      context: z.string().optional().describe('附加上下文信息'),
    }),
    execute: async ({ task, context }) => {
      // 1. 一次性解析 Agent 运行时配置（模型 + 基础指令 + 选项）
      const runtimeConfig = await agentManager.getAgentRuntimeConfig(tenant_id, id);
      if (!runtimeConfig) {
        return 'Agent runtime configuration not available.';
      }

      // 2. 拼接任务级动态内容到 instructions
      let instructions = runtimeConfig.instructions;
      instructions += `\n\n## 当前任务\n${task}`;
      if (context) {
        instructions += `\n\n## 附加上下文\n${context}`;
      }

      // 3. 构建 tools 并注入到 requestContext，agentProxy 的 tools 函数同步读取
      const tools = await buildAgentTools(agent);

      // 4. 注入运行时配置到 requestContext，agentProxy 的 model/instructions/tools 函数同步读取
      const requestContext = new RequestContext();
      requestContext.set('model', runtimeConfig.model);
      requestContext.set('instructions', instructions);
      if (Object.keys(tools).length > 0) {
        requestContext.set('tools', tools);
      }

      // 5. 调用 agentProxy.generate()
      const threadId = `proxy-${id}-${Date.now()}`;
      const options = {
        requestContext,
        maxSteps: runtimeConfig.maxSteps,
        memory: {
          thread: threadId,
          resource: tenant_id,
        },
      };
      const result = await agentProxy.generate([{ role: 'user', content: task }], options);

      return result.text;
    },
  });
}
