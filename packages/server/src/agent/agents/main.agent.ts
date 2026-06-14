import { Agent } from '@mastra/core/agent';
import { createOpenAI } from '@ai-sdk/openai';
import { getMemory } from '../memory-setup.js';
import type { MastraModelConfig } from '@mastra/core/llm';
import type { Tool } from '@mastra/core/tools';
import type { AgentDetail } from '../../services/agent/types.js';
import { buildAgentTools } from '../tools/agent-tools.factory.js';

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
  instructions: `
你是一个通用 AI Agent 调度器（Vico）。你的职责是：

## 核心流程
1. **分析任务**：理解用户的需求和意图
2. **选择 Agent**：从可用的专业 Agent 工具中选择最合适的来执行任务
3. **拆解任务**：对于需要多个专业能力配合的复杂任务，拆解为多个子任务，依次或并行调用不同 Agent
4. **汇总结果**：整合所有子 Agent 的输出，形成连贯、完整的最终回复
5. **自行回答**：如果没有合适的专业 Agent，或任务属于通用问答，直接用自己的知识回答

## 可用 Agent 工具
你的 tools 列表中的每个 agent_* 工具对应一个专业 Agent。工具的 description 说明了该 Agent 的专业领域和能力。

## 注意事项
- 优先使用专业 Agent 处理专业任务，不要越俎代庖
- 如果任务简单（如问候、闲聊）或没有匹配的 Agent，直接自己回答，不要强行调用工具
- 可以一次调用多个 Agent 处理复杂任务的不同方面
- 汇总结果时保持信息完整，不要丢失重要内容
- 如果 Agent 返回的结果不完整或有问题，可以补充说明
`.trim(),
  model: ({ requestContext }) => {
    const model = requestContext?.get('model') as MastraModelConfig | undefined;
    if (model) return model;
    // 回退：仅在未传入 requestContext 或未配置模型时使用
    return createOpenAI({ apiKey: process.env.OPENAI_API_KEY || 'sk-placeholder' }).chat('gpt-4o');
  },
  tools: async ({ requestContext }) => {
    const agentDetail = requestContext?.get('agentDetail') as AgentDetail | undefined;
    const tenantTools = (requestContext?.get('tools') as Record<string, Tool> | undefined) || {};
    const tools: Record<string, Tool> = { ...tenantTools };
    if (agentDetail) {
      Object.assign(tools, await buildAgentTools(agentDetail));
    }
    return tools;
  },
  memory: getMemory(),
  defaultOptions: {
    maxSteps: 15,
  },
});
