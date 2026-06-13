import { Agent } from '@mastra/core/agent';
import { createOpenAI } from '@ai-sdk/openai';
import { getMemory } from '../../memory-setup.js';
import { resolveModelProvider } from '../bridges/model-bridge.js';
import type { ModelConfigRow } from '../../model-registry.js';

/**
 * Agent 代理模板 — 通用 Agent 代理。
 *
 * Mastra 不支持动态注册 Agent 实例。用户在 UI 上创建的 Agent
 * 以数据库配置形式存在，通过此模板 + 每次 generate() 调用时传入
 * runtimeContext 来模拟"多 Agent"效果。
 *
 * 每次调用是独立的对话，不共享上下文。
 *
 * model 使用动态函数：从 runtimeContext 中读取用户在 Web 端配置的
 * 模型信息，无需在构造函数中硬编码模型。若调用方未传入 runtimeContext
 * 或未设置 modelConfig，则回退到占位模型。
 */
export const agentProxy = new Agent({
  id: 'agent-proxy',
  name: 'Agent Proxy',
  description: '通用 Agent 代理，根据运行时上下文配置执行不同角色的任务',
  instructions: 'You are a helpful assistant.',
  model: ({ requestContext }) => {
    const modelConfig = requestContext?.get('modelConfig') as ModelConfigRow | undefined;
    if (modelConfig) {
      return resolveModelProvider(modelConfig);
    }
    // 回退：仅在未传入 runtimeContext 或未配置模型时使用
    return createOpenAI({ apiKey: 'sk-placeholder' }).chat('gpt-4o');
  },
  memory: getMemory(),
  defaultOptions: {
    maxSteps: 10,
  },
});
