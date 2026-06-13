import { Agent } from '@mastra/core/agent';
import { createOpenAI } from '@ai-sdk/openai';
import { getMemory } from '../../memory-setup.js';
import { modelManager } from '../../../services/model/model-manager.js';
import { agentManager } from '../../../services/agent/agent-manager.js';

/**
 * Agent 代理模板 — 通用 Agent 代理。
 *
 * Mastra 不支持动态注册 Agent 实例。用户在 UI 上创建的 Agent
 * 以数据库配置形式存在，通过此模板 + 每次 generate() 调用时传入
 * runtimeContext 来模拟"多 Agent"效果。
 *
 * 每次调用是独立的对话，不共享上下文。
 *
 * model 使用动态函数：从 runtimeContext 中读取 agentId + tenantId，
 * 通过 agentManager 获取 Agent 实例，再根据其 model_id 从 modelManager
 * 解析出模型。若调用方未传入 runtimeContext 或解析失败，则回退到占位模型。
 */
export const agentProxy = new Agent({
  id: 'agent-proxy',
  name: 'Agent Proxy',
  description: '通用 Agent 代理，根据运行时上下文配置执行不同角色的任务',
  instructions: 'You are a helpful assistant.',
  model: async ({ requestContext }) => {
    const agentId = requestContext?.get('agentId') as string | undefined;
    const tenantId = requestContext?.get('tenantId') as string | undefined;

    if (agentId && tenantId) {
      try {
        const agent = await agentManager.getById(tenantId, agentId);
        if (agent?.model_id) {
          const model = await modelManager.resolveModelConfig(tenantId, agent.model_id);
          if (model) return model;
        }
      } catch {
        // 解析失败时继续走回退
      }
    }

    // 回退：仅在未传入 runtimeContext 或解析失败时使用
    return createOpenAI({ apiKey: 'sk-placeholder' }).chat('gpt-4o');
  },
  memory: getMemory(),
  defaultOptions: {
    maxSteps: 10,
  },
});
