import { Agent } from '@mastra/core/agent';
import { getMemory } from '../../memory-setup.js';

/**
 * Agent Proxy Template — 通用 Agent 代理模板。
 *
 * Mastra 不支持动态注册 Agent 实例。用户在 UI 上创建的 Agent
 * 以数据库配置形式存在，通过此模板 + 不同的 RunContext 来模拟
 * "多 Agent" 效果。
 *
 * 此 Agent 的 instructions/model/tools 均在运行时由 agent-tool.factory.ts
 * 通过 agentProxy.run() 的 context 参数动态注入。
 * 每次调用是独立的对话，不共享上下文。
 */
export const agentProxy = new Agent({
  id: 'agent-proxy',
  name: 'Agent Proxy',
  description: '通用 Agent 代理，根据运行时上下文配置执行不同角色的任务',
  instructions: 'You are a helpful assistant.',
  model: null as any,
  memory: getMemory(),
  defaultOptions: {
    maxSteps: 10,
  },
});
