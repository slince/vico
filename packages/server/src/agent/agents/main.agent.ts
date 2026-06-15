import {Agent} from '@mastra/core/agent';
import {getMemory} from '../memory-setup.js';
import {getWorkspace} from '../workspace-setup.js';
import type {MastraModelConfig} from '@mastra/core/llm';
import type {AgentDetail} from '../../services/agent/types.js';
import {buildMainAgentTools} from '../agent-tools.factory.js';

/**
 * Main Agent — 通用任务路由调度器。
 *
 * 职责：
 * 1. 接收用户消息，理解任务意图
 * 2. 从可用的 Agent Tool 列表中选择最合适的执行
 * 3. 复杂任务拆解为多个子任务分派
 * 4. 汇总子 Agent 结果，返回整合后的最终回复
 * 5. 没有合适 Agent 时自行回答
 *
 * 模型和工具通过 requestContext 动态注入，使用当前租户的默认模型配置。
 * 未传入 requestContext 时回退为占位模型。
 */
export const mainAgent = new Agent({
  id: 'main',
  name: 'Vico',
  description: '通用 AI 助手，能够理解任务、分派给专业 Agent、汇总结果',
  instructions: ({ requestContext }) => {
    return requestContext.get('instructions');
  },
  model: ({ requestContext }) => {
    const model = requestContext.get('model') as MastraModelConfig;
    if (!model) throw new Error('Model not configured for main agent');
    return model;
  },
  tools: async ({ requestContext }) => {
    const agentDetail = requestContext?.get('agentDetail') as AgentDetail | undefined;
    if (agentDetail) {
      return buildMainAgentTools(agentDetail);
    }
    return {};
  },
  workspace: getWorkspace(),
  memory: await getMemory(),
  defaultOptions: {
    maxSteps: 15,
  },
});
