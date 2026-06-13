/**
 * AgentToolFactory — 将数据库中用户定义的 Agent 转换为 Mastra Tool。
 *
 * 每个工具代表一个"委托给专业 Agent"的操作。当 Mastra vicoMain Agent
 * 调用该工具时，execute 内部通过 agentProxy.generate() 动态配置并执行
 * 目标 Agent。模型配置通过 runtimeContext 注入，由 agentProxy 的 model
 * 函数在运行时动态解析。
 */
import { createTool } from '@mastra/core/tools';
import { RequestContext } from '@mastra/core/request-context';
import { z } from 'zod';
import { agentProxy } from '../agents/agent-proxy.agent.js';
import { getSkillToolsForMastraAgent } from '../../tools/skill-tool-adapter.js';
import { createRagSearchTool } from '../../tools/rag-tool.js';
import { skillManager } from '../../../skill/manager.js';
import logger from '../../../lib/logger.js';

/** Vico Agent 数据库行的最小类型 */
interface AgentRow {
  id: string;
  name: string;
  description?: string | null;
  system_prompt?: string | null;
  model_id?: string | null;
  rag_mode?: string | null;
  max_steps?: number | null;
}

/**
 * 为单个用户定义的 Agent 创建 Mastra Tool。
 *
 * 返回的 Tool 可被 vicoMainAgent 作为子 Agent 工具调用。
 * execute 中按需加载目标 Agent 的完整配置（模型配置、提示词、技能工具、RAG），
 * 模型配置通过 RuntimeContext 注入 agentProxy，由其 model 函数动态解析。
 *
 * 每个调用使用独立的 memory thread，确保不同委托之间上下文隔离。
 *
 * @param agentRow - 来自 agents 表的 Agent 配置行
 * @param tenantId - 租户 ID，用于多租户数据隔离
 * @returns Mastra Tool 实例
 */
export function createAgentTool(agentRow: AgentRow, tenantId: string) {
  return createTool({
    id: `agent_${agentRow.id}`,
    description: `委托任务给「${agentRow.name}」Agent。${agentRow.description || ''}。当用户需要 ${agentRow.name} 相关能力时调用此工具`,
    inputSchema: z.object({
      task: z.string().describe(`要委托给 ${agentRow.name} 的具体任务描述`),
      context: z.string().optional().describe('附加上下文信息'),
    }),
    execute: async ({ task, context }) => {
      // 1. 构建 instructions（系统提示词 + Skill 提示词）
      let instructions = agentRow.system_prompt || 'You are a helpful assistant.';
      try {
        const skillPrompts = await skillManager.getPromptForAgent(agentRow.id);
        if (skillPrompts) {
          instructions += '\n\n## 技能指南\n' + skillPrompts;
        }
      } catch (err) {
        logger.warn({ err, agentId: agentRow.id }, 'Failed to load skill prompts');
      }
      instructions += `\n\n## 当前任务\n${task}`;
      if (context) {
        instructions += `\n\n## 附加上下文\n${context}`;
      }

      // 2. 构建 tools: Skill Tools + RAG Tool
      const tools: Record<string, any> = {};
      try {
        const skillTools = await getSkillToolsForMastraAgent(agentRow.id, {
          tenantId,
          agentId: agentRow.id,
          userId: '',
          skillConfig: {},
        });
        Object.assign(tools, skillTools);
      } catch (err) {
        logger.warn({ err, agentId: agentRow.id }, 'Failed to load skill tools');
      }

      try {
        if (agentRow.rag_mode !== 'disabled') {
          const ragTool = await createRagSearchTool(agentRow.id, tenantId);
          if (ragTool) {
            tools[ragTool.id] = ragTool;
          }
        }
      } catch (err) {
        logger.warn({ err, agentId: agentRow.id }, 'Failed to create RAG tool');
      }

      // 3. 创建 requestContext 并注入 agentId + tenantId，
      //    agentProxy 的 model 函数会据此解析模型配置
      const requestContext = new RequestContext();
      requestContext.set('agentId', agentRow.id);
      requestContext.set('tenantId', tenantId);

      // 4. 调用 agentProxy.generate()
      const result = await agentProxy.generate(
        [{ role: 'user', content: task }],
        {
          instructions,
          requestContext,
          clientTools: Object.keys(tools).length > 0 ? tools : undefined,
          maxSteps: agentRow.max_steps ?? 10,
          memory: {
            thread: `proxy-${agentRow.id}-${Date.now()}`,
            resource: tenantId,
          },
        } as any,
      );

      return result.text;
    },
  });
}
