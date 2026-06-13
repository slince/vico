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
import { getSkillToolsForMastraAgent } from '../tools/skill-tool-adapter.js';
import { createRagSearchTool } from '../tools/rag-tool.js';
import { agentManager } from '../../services/agent/agent-manager.js';
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
 * @param agent - 来自 agents 表的 Agent 配置行
 * @param tenantId - 租户 ID，用于多租户数据隔离
 * @returns Mastra Tool 实例
 */
export function createAgentTool(agent: AgentDetail, tenantId: string) {
  return createTool({
    id: `agent_${agent.id}`,
    description: `委托任务给「${agent.name}」Agent。当用户需要 ${agent.name} 相关能力时调用此工具`,
    inputSchema: z.object({
      task: z.string().describe(`要委托给 ${agent.name} 的具体任务描述`),
      context: z.string().optional().describe('附加上下文信息'),
    }),
    execute: async ({ task, context }) => {
      // 1. 一次性解析 Agent 运行时配置（模型 + 基础指令 + 选项）
      const runtimeConfig = await agentManager.getAgentRuntimeConfig(tenantId, agent.id);
      if (!runtimeConfig) {
        return 'Agent runtime configuration not available.';
      }

      // 2. 拼接任务级动态内容到 instructions
      let instructions = runtimeConfig.instructions;
      instructions += `\n\n## 当前任务\n${task}`;
      if (context) {
        instructions += `\n\n## 附加上下文\n${context}`;
      }

      // 3. 构建 tools: Skill Tools + RAG Tool
      const tools: Record<string, any> = {};
      const skillTools = await getSkillToolsForMastraAgent(agent.id, {
        tenantId,
        agentId: agent.id,
        userId: '',
        skillConfig: {},
      });
      Object.assign(tools, skillTools);

      if (agent.rag_mode !== 'disabled') {
        const ragTool = await createRagSearchTool(agent);
        if (ragTool) {
          tools[ragTool.id] = ragTool;
        }
      }

      // 4. 注入运行时配置到 requestContext，agentProxy 的 model/instructions 函数同步读取
      const requestContext = new RequestContext();
      requestContext.set('model', runtimeConfig.model);
      requestContext.set('instructions', instructions);

      // 5. 调用 agentProxy.generate()
      const threadId = `proxy-${agent.id}-${Date.now()}`;
      const options = {
        requestContext,
        clientTools: Object.keys(tools).length > 0 ? tools : undefined,
        maxSteps: runtimeConfig.maxSteps,
        memory: {
          thread: threadId,
          resource: tenantId,
        },
      };
      const result = await agentProxy.generate([{ role: 'user', content: task }], options);

      return result.text;
    },
  });
}
