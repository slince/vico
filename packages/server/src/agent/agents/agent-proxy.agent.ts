import { Agent } from '@mastra/core/agent';
import { createOpenAI } from '@ai-sdk/openai';
import { getMemory } from '../memory-setup.js';
import type { MastraModelConfig } from '@mastra/core/llm';
import { buildAgentTools } from '../tools/agent-tools.factory.js';
import type { AgentDetail } from '../../services/agent/types.js';

/**
 * Agent 代理模板 — 通用 Agent 代理。
 *
 * Mastra 不支持动态注册 Agent 实例。用户在 UI 上创建的 Agent
 * 以数据库配置形式存在，通过此模板 + 每次 generate() 调用时传入
 * requestContext 来模拟"多 Agent"效果。
 *
 * 每次调用是独立的对话，不共享上下文。
 *
 * model、instructions 从 requestContext 同步读取，调用方应在调用前
 * 通过 agentManager.getAgentRuntimeConfig() 获取配置并注入。
 * tools 由 agentProxy 自行根据 requestContext 中的 AgentDetail 构建。
 */
export const agentProxy = new Agent({
  id: 'agent-proxy',
  name: 'Agent Proxy',
  description: '通用 Agent 代理，根据运行时上下文配置执行不同角色的任务',
  instructions: ({ requestContext }) => {
    return requestContext?.get('instructions') as string || 'You are a helpful assistant.';
  },
  model: ({ requestContext }) => {
    const model = requestContext?.get('model') as MastraModelConfig | undefined;
    if (model) return model;
    // 回退：仅在未传入 requestContext 或未配置模型时使用
    return createOpenAI({ apiKey: 'sk-placeholder' }).chat('gpt-4o');
  },
  tools: async ({ requestContext }) => {
    const agentDetail = requestContext?.get('agentDetail') as AgentDetail | undefined;
    if (agentDetail) {
      return buildAgentTools(agentDetail);
    }
    return {};
  },
  memory: getMemory(),
  defaultOptions: {
    maxSteps: 10,
  },
});
